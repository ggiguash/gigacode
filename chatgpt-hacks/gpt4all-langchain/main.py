from langchain import PromptTemplate, LLMChain
from langchain.llms import GPT4All
from langchain.callbacks.streaming_stdout import StreamingStdOutCallbackHandler
from langchain.embeddings import HuggingFaceEmbeddings
from langchain.document_loaders import DirectoryLoader
from langchain.vectorstores.faiss import FAISS
from langchain.text_splitter import RecursiveCharacterTextSplitter

# See https://github.com/nomic-ai/gpt4all/blob/main/gpt4all-chat/metadata/models.json
# for a full list of GPT4All models
local_path = './models/ggml-gpt4all-j-v1.3-groovy.bin'
# See https://www.sbert.net/docs/pretrained_models.html
# for the list of pretrained models
embeddings = HuggingFaceEmbeddings(model_name='all-mpnet-base-v2')

template = """
Please use the following context to answer questions.
Context: {context}
---
Query: {query}

"""

# Split text
def split_chunks(sources):
    chunks = []
    splitter = RecursiveCharacterTextSplitter(chunk_size=256, chunk_overlap=32)
    for chunk in splitter.split_documents(sources):
        chunks.append(chunk)
    return chunks

def create_index(chunks):
    texts = [doc.page_content for doc in chunks]
    metadatas = [doc.metadata for doc in chunks]
    search_index = FAISS.from_texts(texts, embeddings, metadatas=metadatas)
    return search_index

def similarity_search(query, index):
    # k is the number of similarity searched that matches the query
    # default is 4
    matched_docs = index.similarity_search(query, k=4)
    sources = []
    for doc in matched_docs:
        sources.append(
            {
                "page_content": doc.page_content,
                "metadata": doc.metadata,
            }
        )
    return matched_docs, sources

#
# Main
#

# Load data using UnstructuredLoader
print("Adding data to GPT...")
loader = DirectoryLoader("./data/")

docs = loader.load()
chunks = split_chunks(docs)
index = create_index(chunks)
context = ""

callbacks = [StreamingStdOutCallbackHandler()]
llm = GPT4All(model=local_path, backend='gptj', callbacks=callbacks, verbose=True)
prompt = PromptTemplate(template=template, input_variables=["context", "query"]).partial(context=context)
llm_chain = LLMChain(prompt=prompt, llm=llm, verbose=False)

while True:
    query = input("\nQuery: ")
    if query == "":
        print("Exiting...")
        break
    matched_docs, sources = similarity_search(query, index)
    context = "\n".join([doc.page_content for doc in matched_docs])
    llm_chain.run(query)
