import React, {useState} from 'react';
import {Text, Box, Static, useInput, useApp} from 'ink';

export default function Counter() {
	const [count, setCount] = useState(0);
	const [lines, setLines] = useState<string[]>([]);
	const {exit} = useApp();

	useInput((input, key) => {
		setLines(prev => [...prev, `line ${prev.length + 1}: key=${input}`]);
		if (input === 'a') {
			setCount(prev => prev + 1);
		}

		if (input === 'd') {
			setCount(prev => prev - 1);
		}

		if (key.escape || input === 'q') {
			exit();
		}
	});

	return (
		<>
			<Static items={lines}>
				{(line, index) => <Text key={index}>{line}</Text>}
			</Static>
			<Box borderStyle="round" paddingX={2} paddingY={2} flexDirection="column">
				<Box>
					<Text>Count: </Text>
					<Text color="green" bold>
						{count}
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>
						[ -- Press 'a' to +1, 'd' to -1, 'q' to quit -- ]
					</Text>
				</Box>
			</Box>
		</>
	);
}
