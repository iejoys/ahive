/**
 * 产出物收集器
 * 负责扫描和收集工作流执行产生的文件和文档
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorkflowOutput } from './WorkflowStateDB';

/**
 * 产出物收集配置
 */
export interface OutputCollectorConfig {
  // 扫描的目录列表
  outputDirs?: string[];
  // 文件匹配模式
  filePatterns?: string[];
  // 排除的目录
  excludeDirs?: string[];
  // 最大文件大小（字节）
  maxFileSize?: number;
  // 是否收集文件内容
  collectContent?: boolean;
}

/**
 * 产出物类型映射
 */
const OUTPUT_TYPE_MAP: { [ext: string]: WorkflowOutput['outputType'] } = {
  // 文档类型
  '.md': 'document',
  '.txt': 'document',
  '.doc': 'document',
  '.docx': 'document',
  '.pdf': 'document',
  
  // 代码类型
  '.ts': 'code',
  '.tsx': 'code',
  '.js': 'code',
  '.jsx': 'code',
  '.py': 'code',
  '.java': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.c': 'code',
  '.cpp': 'code',
  '.h': 'code',
  '.html': 'code',
  '.css': 'code',
  '.scss': 'code',
  '.less': 'code',
  '.vue': 'code',
  '.svelte': 'code',
  
  // 配置类型
  '.json': 'config',
  '.yaml': 'config',
  '.yml': 'config',
  '.xml': 'config',
  '.toml': 'config',
  '.ini': 'config',
  '.env': 'config',
  
  // 其他
  '.sh': 'code',
  '.bat': 'code',
  '.ps1': 'code',
};

/**
 * 产出物收集器类
 */
export class OutputCollector {
  private config: OutputCollectorConfig;

  constructor(config?: OutputCollectorConfig) {
    this.config = {
      outputDirs: config?.outputDirs || ['docs', 'src', 'dist', 'output'],
      filePatterns: config?.filePatterns || ['*.md', '*.ts', '*.js', '*.json', '*.txt'],
      excludeDirs: config?.excludeDirs || ['node_modules', '.git', 'dist', 'build'],
      maxFileSize: config?.maxFileSize || 10 * 1024 * 1024, // 10MB
      collectContent: config?.collectContent || false,
    };
  }

  /**
   * 扫描目录收集产出物
   */
  collectFromDirectory(
    dir: string,
    instanceId: string,
    nodeId: string,
    nodeName?: string,
    agentId?: string,
    agentName?: string
  ): WorkflowOutput[] {
    const outputs: WorkflowOutput[] = [];

    if (!fs.existsSync(dir)) {
      console.warn(`[OutputCollector] Directory not found: ${dir}`);
      return outputs;
    }

    const scanDir = (currentDir: string) => {
      const items = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const item of items) {
        const itemPath = path.join(currentDir, item.name);

        if (item.isDirectory()) {
          // 检查是否在排除列表中
          if (this.config.excludeDirs!.includes(item.name)) {
            continue;
          }

          // 递归扫描子目录
          scanDir(itemPath);
        } else if (item.isFile()) {
          // 收集文件
          const output = this.collectFile(
            itemPath,
            instanceId,
            nodeId,
            nodeName,
            agentId,
            agentName
          );

          if (output) {
            outputs.push(output);
          }
        }
      }
    };

    scanDir(dir);
    return outputs;
  }

  /**
   * 收集单个文件
   */
  collectFile(
    filePath: string,
    instanceId: string,
    nodeId: string,
    nodeName?: string,
    agentId?: string,
    agentName?: string
  ): WorkflowOutput | null {
    try {
      const stat = fs.statSync(filePath);
      
      // 检查文件大小
      if (stat.size > this.config.maxFileSize!) {
        console.warn(`[OutputCollector] File too large: ${filePath} (${stat.size} bytes)`);
        return null;
      }

      const ext = path.extname(filePath).toLowerCase();
      const outputType = OUTPUT_TYPE_MAP[ext] || 'file';
      const fileName = path.basename(filePath);
      const now = new Date().toISOString();

      const output: WorkflowOutput = {
        instanceId,
        nodeId,
        nodeName,
        outputType,
        outputName: fileName,
        outputPath: filePath,
        fileSize: stat.size,
        fileFormat: ext.replace('.', ''),
        encoding: 'utf-8',
        agentId,
        agentName,
        createdAt: now,
        updatedAt: now,
      };

      // 如果需要收集内容
      if (this.config.collectContent && outputType !== 'file') {
        try {
          output.outputContent = fs.readFileSync(filePath, 'utf-8');
        } catch (error) {
          console.warn(`[OutputCollector] Failed to read file content: ${filePath}`, error);
        }
      }

      return output;
    } catch (error) {
      console.error(`[OutputCollector] Failed to collect file: ${filePath}`, error);
      return null;
    }
  }

  /**
   * 从节点输出中提取产出物
   */
  extractFromNodeOutput(
    nodeOutput: any,
    instanceId: string,
    nodeId: string,
    nodeName?: string,
    agentId?: string,
    agentName?: string
  ): WorkflowOutput[] {
    const outputs: WorkflowOutput[] = [];
    const now = new Date().toISOString();

    if (!nodeOutput || typeof nodeOutput !== 'object') {
      return outputs;
    }

    // 检查输出中的文件路径
    const extractPaths = (obj: any, prefix: string = '') => {
      if (!obj || typeof obj !== 'object') return;

      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (typeof value === 'string') {
          // 检查是否是文件路径
          if (this.isLikelyFilePath(value) && fs.existsSync(value)) {
            const output = this.collectFile(
              value,
              instanceId,
              nodeId,
              nodeName,
              agentId,
              agentName
            );
            if (output) {
              outputs.push(output);
            }
          }
        } else if (typeof value === 'object') {
          extractPaths(value, fullKey);
        }
      }
    };

    extractPaths(nodeOutput);

    // 检查特定的输出字段
    if (nodeOutput.files && Array.isArray(nodeOutput.files)) {
      for (const file of nodeOutput.files) {
        if (typeof file === 'string' && fs.existsSync(file)) {
          const output = this.collectFile(
            file,
            instanceId,
            nodeId,
            nodeName,
            agentId,
            agentName
          );
          if (output) {
            outputs.push(output);
          }
        }
      }
    }

    if (nodeOutput.documents && Array.isArray(nodeOutput.documents)) {
      for (const doc of nodeOutput.documents) {
        if (typeof doc === 'string' && fs.existsSync(doc)) {
          const output = this.collectFile(
            doc,
            instanceId,
            nodeId,
            nodeName,
            agentId,
            agentName
          );
          if (output) {
            outputs.push(output);
          }
        }
      }
    }

    return outputs;
  }

  /**
   * 判断字符串是否可能是文件路径
   */
  private isLikelyFilePath(str: string): boolean {
    // 检查是否包含路径分隔符
    if (!str.includes('/') && !str.includes('\\')) {
      return false;
    }

    // 检查是否有文件扩展名
    const ext = path.extname(str);
    if (!ext || ext.length > 10) {
      return false;
    }

    // 检查是否是绝对路径或相对路径
    return path.isAbsolute(str) || str.startsWith('./') || str.startsWith('../') || str.startsWith('..\\');
  }

  /**
   * 收集工作流产出物
   */
  collectWorkflowOutputs(
    projectPath: string,
    instanceId: string,
    nodeId: string,
    nodeName?: string,
    agentId?: string,
    agentName?: string
  ): WorkflowOutput[] {
    const outputs: WorkflowOutput[] = [];

    for (const outputDir of this.config.outputDirs!) {
      const dirPath = path.join(projectPath, outputDir);
      
      if (fs.existsSync(dirPath)) {
        const dirOutputs = this.collectFromDirectory(
          dirPath,
          instanceId,
          nodeId,
          nodeName,
          agentId,
          agentName
        );
        outputs.push(...dirOutputs);
      }
    }

    return outputs;
  }
}
