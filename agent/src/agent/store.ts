
import path from 'node:path';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { AgentEvent } from '../protocol/events';



export interface SessionStoreInterface {
  load: (sessionId: string) => Promise<AgentEvent[]>;
  append: (sessionId: string, event: AgentEvent) => Promise<void>;
}

export type Config = {
  rootDir: string;
}


export default class SessionStore implements SessionStoreInterface {
  private rootDir: string;
  private isRunning: boolean = false;
  private queue: {
    sessionId: string,
    event: AgentEvent,
    resolve: () => void;
    reject: (reason?: unknown) => void;
  }[] = [];
  constructor(config: Config) {
    this.rootDir = config.rootDir;
  }

  private getFilePath(sessionId: string) {
    return path.join(this.rootDir, `${sessionId}.jsonl`);
  }

  async load(sessionId: string): Promise<AgentEvent[]> {
    try {
      const content = await readFile(this.getFilePath(sessionId), 'utf-8');
      return content
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as AgentEvent)
    } catch (e) {
      throw e;
    }
  }

  async run() {
    const currentJob = this.queue.shift();
    if (!currentJob) return;

    try {
      this.isRunning = true;
      await mkdir(this.rootDir, { recursive: true });
      await appendFile(
        this.getFilePath(currentJob.sessionId),
        `${JSON.stringify(currentJob.event)}\n`,
        'utf-8'
      )
      currentJob.resolve();
    } catch (e) {
      currentJob?.reject(e)
    } finally {
      this.isRunning = false;
      this.run();
    }
  }

  async append(sessionId: string, event: AgentEvent): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    this.queue.push({
      sessionId,
      event,
      resolve,
      reject
    })

    this.run();

    return promise;
  }
}