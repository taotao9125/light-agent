import type { AgentEvent } from '../protocol/events';

type Task<T> = (p: T) => T;
export function pipe<T>(...tasks: Task<T>[]) {
	return (initValue: T): T => {
		return tasks.reduce((acc, task) => {
			acc = task(acc);
			return acc;
		}, initValue)
	}
}



export function toRoundMap(events: AgentEvent[]) {
	const map = new Map<string, AgentEvent[]>();
	for (const event of events) {
		const roundId = event.meta?.roundId;
		if (!roundId) continue;

		if (!map.has(roundId)) {
			map.set(roundId, []);
		}
		map.get(roundId)?.push(event);
	}
	return map;
}


export function truncateText(text: string, maxLength: number) {
	if (text.length <= maxLength) return text;
	const placeHolder = '\n\n...[truncated]...\n\n';

	if (maxLength <= placeHolder.length) return text.slice(0, maxLength);

	const budgetLength = maxLength - placeHolder.length;

	const headLength = Math.floor(budgetLength * 0.7);
	const tailLength = budgetLength - headLength;

	return text.slice(0, headLength) + placeHolder + text.slice(-tailLength);

}


export function stringify(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
    
}