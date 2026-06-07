/** 接入层提供的 prompt 原料（compiler 输入；不含 runtime 块与 SKILL.md 正文）。 */
export namespace Prompts {
	export type Instruction = {
		/** 必须以 Instructions 结尾，如 terminalInstructions */
		tag: string;
		content: string;
	};

	/** skill 索引项：仅 name / description / 路径，正文由 read_file 按需加载。 */
	export type SkillIndexEntry = {
		name: string;
		description: string;
		path: string;
	};

	export type Source = {
		identity: string;
		instructions?: Instruction[];
		skillIndex?: SkillIndexEntry[];
	};
}
