import {EventEmitter} from 'node:events';
import React from 'react';
import test from 'ava';
import {render} from 'ink-testing-library';
import Counter from './source/counter.js';

// ink@4 reads keyboard input in raw mode via the Node stream contract:
// it calls stdin.ref()/unref(), listens for the 'readable' event, and pulls
// data with stdin.read(). ink-testing-library@3's mock stdin predates this:
// it lacks ref/unref/read and emits 'data' on write() instead of 'readable'.
//
// ref()/unref() are invoked synchronously while a useInput component renders,
// so they must exist on the prototype before render() runs. read() and the
// readable-queue behaviour are wired onto each returned stdin instance.
const proto = EventEmitter.prototype as unknown as {
	ref?: () => void;
	unref?: () => void;
};
proto.ref ??= () => {};
proto.unref ??= () => {};

const delay = async (ms: number) =>
	new Promise(resolve => {
		setTimeout(resolve, ms);
	});

// ink renders the count with `<Text color="green" bold>`, so in a
// color-capable terminal the digits are wrapped in ANSI escape codes
// (e.g. `Count: \x1b[1m\x1b[32m2\x1b[39m\x1b[22m`). Strip them so assertions
// don't depend on whether the runner detected color support.
// eslint-disable-next-line no-control-regex
const ansiPattern = /\u001B\[[\d;]*m/g;
const stripAnsi = (value: string) => value.replace(ansiPattern, '');

const renderCounter = () => {
	const result = render(<Counter />);
	const queue: string[] = [];
	const stdin = result.stdin as typeof result.stdin & {
		read: () => string | null;
	};

	// Feed ink through the readable/read() path it actually uses.
	// read() must return null (not undefined) when drained: ink loops
	// `while ((chunk = stdin.read()) !== null)`.
	stdin.read = () => (queue.length > 0 ? queue.shift()! : null);
	stdin.write = (data: string) => {
		queue.push(data);
		stdin.emit('readable');
	};

	return {...result, stdin};
};

// ink attaches its 'readable' listener from a useEffect, i.e. after the first
// render commits. Give that effect a tick to run before sending input.
const press = async (
	stdin: {write: (data: string) => void},
	...keys: string[]
) => {
	await delay(10);
	for (const key of keys) {
		stdin.write(key);
	}

	await delay(30);
};

test('starts at zero', t => {
	const {lastFrame} = renderCounter();

	t.regex(stripAnsi(lastFrame()!), /Count:\s*0/);
});

test('"a" increments the count', async t => {
	const {stdin, lastFrame} = renderCounter();

	await press(stdin, 'a', 'a');

	t.regex(stripAnsi(lastFrame()!), /Count:\s*2/);
});

test('"d" decrements the count', async t => {
	const {stdin, lastFrame} = renderCounter();

	await press(stdin, 'd');

	t.regex(stripAnsi(lastFrame()!), /Count:\s*-1/);
});

test('keypresses are recorded as static lines', async t => {
	const {stdin, lastFrame} = renderCounter();

	await press(stdin, 'a', 'd');

	t.regex(stripAnsi(lastFrame()!), /line 1: key=a/);
	t.regex(stripAnsi(lastFrame()!), /line 2: key=d/);
});
