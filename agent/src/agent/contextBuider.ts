import type { Context } from '../protocol/context';
import type { AgentEvent } from '../protocol/events';

export default function contextBuilder(events: AgentEvent[]): Context {
	return {
		events,
	};
}
