# Tasks

- [x] 任务 1: 安装 `exceljs` 依赖
- [x] 任务 2: 创建 `lib/middleware-mode3.ts` 文件并实现 `parseMode3Middleware` 函数
  - [x] 子任务 2.1: 导入 `ExcelJS` 和 `XLSX` 库
  - [x] 子任务 2.2: 实现图片提取逻辑，并构建图片坐标映射。**特别注意 `exceljs` 行号偏移量，确保图片与数据行严格对应，必要时进行日志验证。**
  - [x] 子任务 2.3: 实现并发控制（例如，每次最多并行上传 5 张图片）上传图片到 Cloudflare R2，并提供上传进度回调给 UI 的 `localizeStatus`。
  - [x] 子任务 2.4: 将清洗后的 JSON 重新打包为模式 1 兼容的 Excel `File` 对象
- [x] 任务 3: 修改 `src/app/page.tsx` 文件
  - [x] 子任务 3.1: 导入 `parseMode3Middleware`
  - [x] 子任务 3.2: 创建 `handleMode3Upload` 函数，用于处理模式 3 的文件上传
  - [x] 子任务 3.3: 在 JSX 中绑定 `handleMode3Upload` 到一个新的 `input` 元素
- [x] 任务 4: 创建 `/api/upload-image` 接口 (如果不存在)
  - [x] 子任务 4.1: 实现 `/api/upload-image/route.ts`，**注意使用 `const formData = await request.formData()` 和 `const file = formData.get('file') as File`，并正确将 `file.arrayBuffer()` 转换为 `Node.js` 的 `Buffer` 后再调用 `R2` 上传工具。**
- [x] 任务 5: 修改后端 `api/localize/finalize/route.ts` 文件
  - [x] 子任务 5.1: 在图片处理逻辑中增加对自有 R2 域名的识别
  - [x] 子任务 5.2: 实现隐式跳过图片抓取和重新上传的逻辑

# Task Dependencies
- [任务 2] 依赖于 [任务 1]
- [任务 3] 依赖于 [任务 2]
- [任务 4] 依赖于 [任务 1] (如果 `/api/upload-image` 不存在，且 `parseMode3Middleware` 需要调用它)
- [任务 5] 独立任务，可并行执行
