import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryVectorStore } from '@langchain/classic/vectorstores/memory';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { Document } from '@langchain/core/documents';
import { OllamaEmbeddings } from '@langchain/ollama';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pdfPath = path.join(__dirname, 'agent.pdf');

const loader = new PDFLoader(pdfPath, { splitPages: false });


const splitter = new RecursiveCharacterTextSplitter({
	chunkSize: 800,
	chunkOverlap: 120,
});

const embeddings = new OllamaEmbeddings({
	model: 'bge-m3',
	baseUrl: 'http://localhost:11434',
});

const vectorStore = new MemoryVectorStore(embeddings);

let indexed = false;

async function indexDocuments() {
	if (indexed) {
		return;
	}

	const docs = await loader.load();
	const splits = await splitter.splitDocuments(docs);

	await vectorStore.addDocuments(splits);
	indexed = true;
}

async function searchDocs(query: string, topK = 3) {
	await indexDocuments();

	const results = await vectorStore.similaritySearchWithScore(query, topK);

	return results.map(([doc, score], index) => ({
			rank: index + 1,
			score,
			text: doc.pageContent,
			source: doc.metadata.source,
			metadata: doc.metadata,
		}));
}

export default searchDocs;
