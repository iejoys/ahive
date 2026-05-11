# 智巢网站管理 (Zhinest Site Manager)

> 通过 API 管理智巢网站，支持动态菜单、页面模块组装、布局模板、静态渲染、版本控制、智能体组合操作。

## 快速开始

### 1. 配置文件

安装此 SKILL 后，需要在你的智能体配置中设置连接信息。通常是在 `config.json` 或环境变量中：

```json
{
  "skills": {
    "zhinest-site-manager": {
      "api_url": "http://localhost:3000/api",
      "api_key": "zhinest-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "admin_token": "可选：管理后台 Token"
    }
  }
}
```

### 2. 获取配置信息

**API 地址 (`api_url`)**:
- **本地开发**: `http://localhost:3000/api`
- **服务器部署**: `http://<你的服务器IP>:3000/api` 或 `https://<你的域名>/api`
- 取决于智巢服务部署在哪里，端口默认为 `3000`。

**API Key (`api_key`)**:
- API Key 存储在数据库 `api_keys` 表中。
- 你可以通过数据库查询获取，或在智巢管理后台生成。
- 格式为 `zhinest-` 开头加 32 位哈希值。
- 如果还没有 Key，可以直接插入一条记录到数据库：
  ```sql
  -- 示例：创建一个全权限的 API Key (实际使用时请生成安全的 key 并存储其 SHA256 哈希)
  INSERT INTO api_keys (name, key_hash, permissions, is_active) 
  VALUES ('agent-key', sha256('zhinest-your-key-here'), '["*"]', 1);
  ```

**管理后台 Token (`admin_token`)** (可选):
- 如果需要操作管理后台接口 (`/api/admin/*`)，需要先调用登录接口获取 Token：
  ```bash
  POST /api/admin/auth/login
  Body: { "username": "admin", "password": "你的密码" }
  ```

### 3. 验证连接

配置完成后，可以通过调用 `zhinest_stats` 工具或请求 `GET /api/stats` 来验证连接是否成功。

### 认证方式说明

- **API Key 认证**: 所有 `/api/*` 路由（除公开只读接口外）需要在请求头携带：
  ```
  X-API-Key: <你的 api_key>
  ```
- **Admin Token 认证**: `/api/admin/*` 路由需要携带：
  ```
  Authorization: Bearer <admin_token>
  ```

## 核心概念

### 架构关系

```
Layout (布局) ── 定义页面区域结构 (hero, content, footer...)
    │
Template (模板) ── 绑定布局 + 默认模块配置
    │
Page (页面) ── 使用模板/布局 + 关联模块实例
    │
Module (模块) ── 可复用的内容组件 (Hero, Feature Grid, Stats Bar...)
    │
Page_Module (页面-模块关联) ── 将模块实例化到页面的指定区域
```

### 模块类型清单

| 类型 | 说明 | 常用 props |
|------|------|-----------|
| `hero` | 首屏横幅 | `title`, `subtitle`, `cta_text`, `cta_url`, `bg_image` |
| `feature-grid` | 特性卡片网格 | `columns`, `items: [{icon, title, desc}]` |
| `stats-bar` | 统计数据条 | `items: [{value, label}]` |
| `cta-block` | 行动号召 | `title`, `desc`, `btn_text`, `btn_url` |
| `card-list` | 卡片列表 | `items: [{title, desc, image, link}]` |
| `text-block` | 纯文本块 | `content` (支持 Markdown) |
| `image-banner` | 图片横幅 | `image_url`, `overlay_text` |
| `testimonial` | 用户评价 | `items: [{name, role, avatar, quote}]` |
| `faq` | 常见问题 | `items: [{question, answer}]` |
| `pricing` | 价格表 | `plans: [{name, price, features, cta}]` |
| `team` | 团队展示 | `members: [{name, role, avatar, bio}]` |
| `contact-form` | 联系表单 | `fields`, `submit_text`, `action_url` |

### 返回格式约定

所有列表接口统一返回：
```json
{ "items": [...], "total": 100, "limit": 50, "offset": 0 }
```

单个资源接口直接返回对象：
```json
{ "id": 1, "title": "...", ... }
```

删除操作返回：
```json
{ "success": true, "message": "..." }
```

## API 工具集

### 页面管理

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_page_list` | GET | `/pages` | 获取页面列表 |
| `zhinest_page_get` | GET | `/pages/:slug` | 获取单个页面 |
| `zhinest_page_create` | POST | `/pages` | 创建页面 |
| `zhinest_page_update` | PUT | `/pages/:id` | 更新页面 |
| `zhinest_page_delete` | DELETE | `/pages/:id` | 删除页面 |

### 菜单管理

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_menu_list` | GET | `/menus` | 获取菜单列表 |
| `zhinest_menu_add` | POST | `/menus` | 添加菜单项 |
| `zhinest_menu_update` | PUT | `/menus/:id` | 更新菜单项 |
| `zhinest_menu_delete` | DELETE | `/menus/:id` | 删除菜单项 |
| `zhinest_menu_reorder` | PUT | `/menus/reorder` | 批量排序菜单 |

### 模块管理

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_module_list` | GET | `/modules` | 获取模块列表 |
| `zhinest_module_get` | GET | `/modules/:id` | 获取单个模块 |
| `zhinest_module_create` | POST | `/modules` | 创建模块 |
| `zhinest_module_update` | PUT | `/modules/:id` | 更新模块 |
| `zhinest_module_delete` | DELETE | `/modules/:id` | 删除模块 |

### 页面模块关联

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_page_modules` | GET | `/page-modules/:pageId/modules` | 获取页面模块（按region分组） |
| `zhinest_page_module_add` | POST | `/page-modules/:pageId/modules` | 为页面添加模块 |
| `zhinest_page_module_update` | PUT | `/page-modules/:pageId/modules/:pmId` | 更新模块实例 |
| `zhinest_page_module_remove` | DELETE | `/page-modules/:pageId/modules/:pmId` | 移除模块 |
| `zhinest_page_module_reorder` | PUT | `/page-modules/:pageId/modules/reorder` | 批量调整排序 |

### 布局管理

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_layout_list` | GET | `/layouts` | 获取布局列表 |
| `zhinest_layout_get` | GET | `/layouts/:id` | 获取单个布局 |
| `zhinest_layout_create` | POST | `/layouts` | 创建布局 |
| `zhinest_layout_update` | PUT | `/layouts/:id` | 更新布局 |
| `zhinest_layout_delete` | DELETE | `/layouts/:id` | 删除布局 |

### 模板管理

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_template_list` | GET | `/templates` | 获取模板列表 |
| `zhinest_template_get` | GET | `/templates/:id` | 获取单个模板 |
| `zhinest_template_create` | POST | `/templates` | 创建模板 |
| `zhinest_template_update` | PUT | `/templates/:id` | 更新模板 |
| `zhinest_template_delete` | DELETE | `/templates/:id` | 删除模板 |

### 文章管理

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_article_list` | GET | `/articles` | 获取文章列表 |
| `zhinest_article_get` | GET | `/articles/:slug` | 获取单个文章 |
| `zhinest_article_create` | POST | `/articles` | 创建文章 |
| `zhinest_article_update` | PUT | `/articles/:id` | 更新文章 |
| `zhinest_article_delete` | DELETE | `/articles/:id` | 删除文章 |

### 媒体管理

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_media_list` | GET | `/media` | 获取媒体列表 |
| `zhinest_media_upload` | POST | `/media/upload` | 上传文件 |
| `zhinest_media_delete` | DELETE | `/media/:id` | 删除媒体 |

### 渲染服务

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_render_all` | POST | `/render` | 全站静态渲染 |
| `zhinest_render_incremental` | POST | `/render/incremental` | 增量渲染 |
| `zhinest_render_page` | POST | `/render/page/:slug` | 渲染指定页面 |
| `zhinest_render_status` | GET | `/render/status` | 获取渲染状态 |

### 版本控制

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_version_list` | GET | `/versions/:type/:id` | 获取版本历史 |
| `zhinest_version_rollback` | POST | `/versions/:type/:id/rollback` | 回滚到指定版本 |

### 系统管理

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_health` | GET | `/health` | 健康检查 |
| `zhinest_stats` | GET | `/stats` | 站点统计数据 |
| `zhinest_config_get` | GET | `/config` | 获取站点配置 |
| `zhinest_config_update` | PUT | `/config` | 更新站点配置 |
| `zhinest_operation_logs` | GET | `/operation-logs` | 获取操作日志 |

### 智能体操作

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_agent_create_column` | POST | `/agent/create-column` | 一键创建完整栏目 |
| `zhinest_agent_publish_article` | POST | `/agent/publish-article` | 一键发布文章 |
| `zhinest_agent_update_homepage` | POST | `/agent/update-homepage` | 更新首页 |
| `zhinest_agent_batch` | POST | `/agent/batch-operations` | 批量操作 |

### 管理后台认证

| 工具 | 方法 | 端点 | 说明 |
|------|------|------|------|
| `zhinest_admin_login` | POST | `/admin/auth/login` | 管理员登录获取 token |
| `zhinest_admin_me` | GET | `/admin/auth/me` | 获取当前用户信息 |
| `zhinest_admin_change_password` | PUT | `/admin/auth/change-password` | 修改密码 |

## 使用示例

### 示例 1：一键创建栏目

```json
{
  "tool": "zhinest_agent_create_column",
  "input": {
    "name": "产出物",
    "slug": "deliveries",
    "location": "header",
    "sort_order": 3,
    "template": "category"
  }
}
```

**效果**：自动创建菜单项 + 页面 + 关联模板默认模块

### 示例 2：组装首页

```json
// 1. 创建 Hero 模块
{
  "tool": "zhinest_module_create",
  "input": {
    "name": "首页横幅",
    "type": "hero",
    "props": {
      "title": "智巢 - AI 驱动的网站管理系统",
      "subtitle": "让 AI 智能体通过 API 自主管理网站",
      "cta_text": "开始使用",
      "cta_url": "/kb"
    },
    "status": "active"
  }
}

// 2. 将模块关联到首页
{
  "tool": "zhinest_page_module_add",
  "input": {
    "page_id": 1,
    "module_id": 1,
    "region": "hero",
    "sort_order": 0
  }
}

// 3. 触发渲染
{
  "tool": "zhinest_render_all",
  "input": {}
}
```

### 示例 3：发布文章

```json
{
  "tool": "zhinest_agent_publish_article",
  "input": {
    "title": "智巢 v2.0 发布",
    "content": "# 智巢 v2.0\n\n新增了布局、模板、版本控制等功能...",
    "category": "公告",
    "tags": ["发布", "v2.0"],
    "author": "AI"
  }
}
```

### 示例 4：版本回滚

```json
// 1. 查看版本历史
{
  "tool": "zhinest_version_list",
  "input": { "type": "page", "id": 1 }
}

// 2. 回滚到版本 3
{
  "tool": "zhinest_version_rollback",
  "input": { "type": "page", "id": 1, "version": 3 }
}
```

## 自动化场景

### 每日资讯更新
```
触发: 定时 (每天 9:00)
流程: 获取资讯 → zhinest_agent_publish_article → zhinest_render_incremental
```

### 产品发布公告
```
触发: 事件 (product_release)
流程: zhinest_agent_create_column → zhinest_agent_publish_article → zhinest_render_all
```

### SEO 优化检查
```
触发: 定时 (每周日 0:00)
流程: zhinest_page_list → 检查 meta → zhinest_page_update 补充缺失信息
```

## 错误码

| 状态码 | 说明 |
|--------|------|
| 400 | 请求参数错误 |
| 401 | API Key 无效或缺少认证 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 409 | 资源冲突（如 slug 已存在） |
| 500 | 服务器内部错误 |

## 注意事项

1. **认证**：所有 `/api/*` 路由需要 `X-API-Key` 头
2. **Slug 唯一性**：页面和文章的 slug 不能重复
3. **渲染触发**：修改内容后需调用渲染 API 才能生成静态文件
4. **模块 props**：创建模块时 `props` 为 JSON 对象，不是字符串
5. **事务安全**：智能体操作（create-column, publish-article）使用数据库事务
6. **文件上传**：媒体上传限制 10MB，支持 jpg/png/gif/webp/pdf
