/**
 * Knowledge Base - 知识库专家系统核心
 * 
 * 功能:
 * - 文档导入与解析
 * - 知识分块与向量化
 * - 语义搜索
 * - 引用溯源
 */

// ============ 核心接口 ============

/**
 * 文档类型
 */
export type DocumentType = 
  | 'pdf'
  | 'markdown'
  | 'html'
  | 'txt'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'json';

/**
 * 文档元数据
 */
export interface DocumentMetadata {
  title?: string;
  author?: string;
  createdAt?: Date;
  updatedAt?: Date;
  version?: string;
  tags?: string[];
  source?: string;
  [key: string]: any;
}

/**
 * 文档对象
 */
export interface Document {
  id: string;
  type: DocumentType;
  content: string;
  metadata: DocumentMetadata;
  chunks: Chunk[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 知识分块
 */
export interface Chunk {
  id: string;
  docId: string;
  content: string;
  embedding?: number[];
  metadata: {
    page?: number;
    section?: string;
    index: number;
    [key: string]: any;
  };
  createdAt: Date;
}

/**
 * 知识检索结果
 */
export interface SearchResult {
  chunk: Chunk;
  score: number;
  doc?: Document;
}

/**
 * 分块策略配置
 */
export interface ChunkingStrategy {
  method: 'fixed' | 'semantic' | 'recursive';
  chunkSize: number;        // 每块大小（字符）
  overlap: number;          // 重叠大小
  separators?: string[];    // 分隔符
}

/**
 * 知识库配置
 */
export interface KnowledgeBaseConfig {
  dbPath?: string;          // 向量数据库路径
  embeddingModel?: string;  // 嵌入模型名称
  chunking?: ChunkingStrategy;
  maxResults?: number;      // 最大返回结果数
  scoreThreshold?: number;  // 最低相似度阈值
}

/**
 * 知识库统计
 */
export interface KnowledgeBaseStats {
  totalDocuments: number;
  totalChunks: number;
  totalSize: number;        // 字节
  lastUpdated: Date;
  documentTypes: Record<string, number>;
}

// ============ 知识库管理器 ============

/**
 * 知识库管理器
 * 
 * 当前实现：基于内存的简化版
 * 完整版本：集成 LanceDB 向量数据库
 */
export class KnowledgeBase {
  private documents: Map<string, Document> = new Map();
  private chunks: Map<string, Chunk> = new Map();
  private config: KnowledgeBaseConfig;

  constructor(config: KnowledgeBaseConfig = {}) {
    this.config = {
      dbPath: './data/vectors',
      embeddingModel: 'bge-m3',
      chunking: {
        method: 'recursive',
        chunkSize: 500,
        overlap: 50,
        separators: ['\n\n', '\n', '.', ' ']
      },
      maxResults: 5,
      scoreThreshold: 0.5,
      ...config
    };
  }

  /**
   * 导入文档
   */
  async importDocument(
    content: string,
    type: DocumentType,
    metadata?: DocumentMetadata
  ): Promise<Document> {
    const docId = this.generateId('doc');
    
    // 创建文档对象
    const document: Document = {
      id: docId,
      type,
      content,
      metadata: metadata || {},
      chunks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 分块处理
    const chunks = this.chunkText(content, docId);
    document.chunks = chunks;

    // 存储文档和分块
    this.documents.set(docId, document);
    chunks.forEach(chunk => this.chunks.set(chunk.id, chunk));

    // TODO: 向量化并存储到向量数据库
    // await this.vectorizeChunks(chunks);

    return document;
  }

  /**
   * 删除文档
   */
  async deleteDocument(docId: string): Promise<void> {
    const doc = this.documents.get(docId);
    if (!doc) {
      throw new Error(`Document not found: ${docId}`);
    }

    // 删除所有分块
    doc.chunks.forEach(chunk => {
      this.chunks.delete(chunk.id);
    });

    // 删除文档
    this.documents.delete(docId);
  }

  /**
   * 获取文档
   */
  async getDocument(docId: string): Promise<Document | undefined> {
    return this.documents.get(docId);
  }

  /**
   * 列出所有文档
   */
  async listDocuments(): Promise<Document[]> {
    return Array.from(this.documents.values());
  }

  /**
   * 搜索知识（当前为关键字搜索）
   * TODO: 升级为向量语义搜索
   */
  async search(query: string, limit?: number): Promise<SearchResult[]> {
    const maxResults = limit || this.config.maxResults || 5;
    
    // 简化实现：关键字匹配
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const chunk of this.chunks.values()) {
      const contentLower = chunk.content.toLowerCase();
      
      // 简单的相关度评分
      let score = 0;
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);
      
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          score += 1;
        }
      }

      if (score > 0) {
        const doc = this.documents.get(chunk.docId);
        results.push({
          chunk,
          score: score / queryWords.length,
          doc
        });
      }
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, maxResults);
  }

  /**
   * 语义搜索（当前简化版）
   * TODO: 使用向量相似度
   */
  async semanticSearch(query: string, limit?: number): Promise<SearchResult[]> {
    // 当前实现与 search 相同
    // 完整版本应使用向量相似度计算
    return this.search(query, limit);
  }

  /**
   * 获取知识库统计
   */
  async getStats(): Promise<KnowledgeBaseStats> {
    const docs = Array.from(this.documents.values());
    
    const documentTypes = docs.reduce((acc, doc) => {
      acc[doc.type] = (acc[doc.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalDocuments: docs.length,
      totalChunks: this.chunks.size,
      totalSize: docs.reduce((acc, doc) => acc + doc.content.length, 0),
      lastUpdated: docs.reduce((latest, doc) => 
        doc.updatedAt > latest ? doc.updatedAt : latest, 
        new Date(0)
      ),
      documentTypes,
    };
  }

  /**
   * 文本分块（递归分块策略）
   */
  private chunkText(content: string, docId: string): Chunk[] {
    const { method, chunkSize, overlap, separators } = this.config.chunking!;
    const chunks: Chunk[] = [];

    if (method === 'fixed') {
      // 固定大小分块
      for (let i = 0; i < content.length; i += chunkSize - overlap) {
        const chunkContent = content.slice(i, i + chunkSize);
        chunks.push({
          id: this.generateId('chunk'),
          docId,
          content: chunkContent,
          metadata: { index: chunks.length },
          createdAt: new Date(),
        });
      }
    } else {
      // 递归分块（按分隔符）
      chunks.push(...this.recursiveChunk(content, docId, chunkSize, separators || ['\n\n', '\n', '.', ' ']));
    }

    return chunks;
  }

  /**
   * 递归分块实现
   */
  private recursiveChunk(
    text: string,
    docId: string,
    maxSize: number,
    separators: string[]
  ): Chunk[] {
    const chunks: Chunk[] = [];

    // 如果文本小于最大大小，直接返回
    if (text.length <= maxSize) {
      chunks.push({
        id: this.generateId('chunk'),
        docId,
        content: text.trim(),
        metadata: { index: 0 },
        createdAt: new Date(),
      });
      return chunks;
    }

    // 尝试按分隔符分割
    let splitPoint = -1;
    let bestSeparator = '';

    for (const sep of separators) {
      const parts = text.split(sep);
      let currentLength = 0;
      let bestIndex = -1;

      for (let i = 0; i < parts.length; i++) {
        if (currentLength + parts[i].length > maxSize) {
          bestIndex = i;
          break;
        }
        currentLength += parts[i].length + sep.length;
      }

      if (bestIndex > 0) {
        splitPoint = text.indexOf(sep, currentLength - parts[bestIndex].length - sep.length);
        if (splitPoint > 0) {
          bestSeparator = sep;
          break;
        }
      }
    }

    if (splitPoint > 0 && bestSeparator) {
      // 找到合适的分割点
      const part1 = text.slice(0, splitPoint).trim();
      const part2 = text.slice(splitPoint + bestSeparator.length);

      chunks.push(...this.recursiveChunk(part1, docId, maxSize, separators));
      chunks.push(...this.recursiveChunk(part2, docId, maxSize, separators));
    } else {
      // 无法按分隔符分割，强制按大小分割
      chunks.push({
        id: this.generateId('chunk'),
        docId,
        content: text.slice(0, maxSize).trim(),
        metadata: { index: 0 },
        createdAt: new Date(),
      });
      chunks.push(...this.recursiveChunk(text.slice(maxSize), docId, maxSize, separators));
    }

    return chunks;
  }

  /**
   * 向量化分块（TODO: 待实现）
   */
  private async vectorizeChunks(chunks: Chunk[]): Promise<void> {
    // TODO: 调用嵌入模型 API 生成向量
    // 例如：BGE-M3, M3E, text-embedding-3-small 等
    
    // 示例代码:
    // for (const chunk of chunks) {
    //   const embedding = await this.generateEmbedding(chunk.content);
    //   chunk.embedding = embedding;
    //   await this.vectorDB.add(chunk);
    // }
  }

  /**
   * 生成嵌入向量（TODO: 待实现）
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // TODO: 实现嵌入向量生成
    // 可以使用:
    // 1. 本地模型（@xenova/transformers）
    // 2. API 服务（OpenAI,智谱，MiniMax）
    // 3. LanceDB 内置嵌入
    
    throw new Error('Embedding not implemented yet');
  }

  /**
   * 生成唯一 ID
   */
  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============ 辅助函数 ============

/**
 * 创建知识库实例
 */
export function createKnowledgeBase(config?: KnowledgeBaseConfig): KnowledgeBase {
  return new KnowledgeBase(config);
}

/**
 * 文档解析器（简化版）
 */
export async function parseDocument(
  content: Buffer | string,
  type: DocumentType
): Promise<string> {
  switch (type) {
    case 'txt':
    case 'markdown':
      return typeof content === 'string' ? content : content.toString('utf8');
    
    case 'json':
      return JSON.stringify(JSON.parse(typeof content === 'string' ? content : content.toString()), null, 2);
    
    case 'html': {
      // 简单 HTML 转文本
      const text = typeof content === 'string' ? content : content.toString('utf8');
      return text.replace(/<[^>]*>/g, ' ');
    }
    
    // TODO: 实现 PDF/Word 等格式解析
    case 'pdf':
    case 'word':
    case 'excel':
    case 'powerpoint':
      throw new Error(`Document type ${type} parsing not implemented yet`);
    
    default:
      return typeof content === 'string' ? content : content.toString('utf8');
  }
}

// 默认导出
export default {
  KnowledgeBase,
  createKnowledgeBase,
  parseDocument,
};
