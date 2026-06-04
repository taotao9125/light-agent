import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pdfPath = path.join(__dirname, 'agent.pdf');

const loader = new PDFLoader(pdfPath, { splitPages: false });

type File = {
	content: string;
	metadata: {
		source: string;
	};
};
export const fileToDocument = (files: File[]) => {
	return files.map((file) => {
		return new Document({
			pageContent: file.content,
			metadata: { source: file.metadata.source },
		});
	});
};

const splitter = new RecursiveCharacterTextSplitter({
	chunkSize: 1000,
	chunkOverlap: 200,
});

async function searchDocs(query: string, topK = 3) {
	const docs = await loader.load();
	const splits = await splitter.splitDocuments(docs);
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	return splits
		.map((doc) => {
			const text = doc.pageContent.toLowerCase();
			const score = terms.reduce((sum, term) => {
				return sum + (text.includes(term) ? 1 : 0);
			}, 0);

			return { doc, score };
		})
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK)
		.map(({ doc, score }, index) => ({
			rank: index + 1,
			score,
			text: doc.pageContent,
			source: doc.metadata.source,
			metadata: doc.metadata,
		}));
}

export default searchDocs;

