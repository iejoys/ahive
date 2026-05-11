declare global {
    interface Window {
        electronAPI: {
            getConfig: () => Promise<{
                webUrl: string;
                apiUrl: string;
            }>;
            openExternal: (url: string) => Promise<void>;
            getAppVersion: () => Promise<string>;
            runCommand: (command: string) => Promise<string>;
            getAgents: () => Promise<any[]>;
            sendMessageToAgent: (agentName: string, message: string) => Promise<{
                success: boolean;
                stdout: string;
                stderr: string;
                error?: string;
            }>;
            getGatewayStatus: () => Promise<{
                status: string;
                error?: string;
            }>;
            startGateway: () => Promise<{
                success: boolean;
                error?: string;
            }>;
            stopGateway: () => Promise<{
                success: boolean;
                error?: string;
            }>;
            onGatewayStatus: (callback: (data: {
                status: string;
                error?: string;
            }) => void) => void;
            platform: string;
            isDesktop: boolean;
            getDataDirectory: () => Promise<string>;
            getAppData: () => Promise<any>;
            saveAppData: (data: any) => Promise<boolean>;
            getScheduledTasks: () => Promise<any[]>;
            saveScheduledTask: (task: any) => Promise<boolean>;
            deleteScheduledTask: (taskId: string) => Promise<boolean>;
            toggleScheduledTask: (taskId: string, enabled: boolean) => Promise<boolean>;
            addTaskRun: (run: any) => Promise<boolean>;
            // 项目配置模板
            getProjectConfigTemplates: (language?: 'zh' | 'en') => Promise<any[]>;
            getProjectConfigTemplate: (templateId: string, language?: 'zh' | 'en') => Promise<any>;
            reloadProjectConfigTemplates: () => Promise<any[]>;
        };
    }
}
declare global {
    interface Window {
        electronAPI: {
            getConfig: () => Promise<{
                webUrl: string;
                apiUrl: string;
            }>;
            openExternal: (url: string) => Promise<void>;
            getAppVersion: () => Promise<string>;
            runCommand: (command: string) => Promise<string>;
            getAgents: () => Promise<any[]>;
            sendMessageToAgent: (agentName: string, message: string) => Promise<{
                success: boolean;
                stdout: string;
                stderr: string;
                error?: string;
            }>;
            getGatewayStatus: () => Promise<{
                status: string;
                error?: string;
            }>;
            startGateway: () => Promise<{
                success: boolean;
                error?: string;
            }>;
            stopGateway: () => Promise<{
                success: boolean;
                error?: string;
            }>;
            onGatewayStatus: (callback: (data: {
                status: string;
                error?: string;
            }) => void) => void;
            platform: string;
            isDesktop: boolean;
            // 项目配置模板
            getProjectConfigTemplates: (language?: 'zh' | 'en') => Promise<any[]>;
            getProjectConfigTemplate: (templateId: string, language?: 'zh' | 'en') => Promise<any>;
            reloadProjectConfigTemplates: () => Promise<any[]>;
        };
    }
}
export {};
