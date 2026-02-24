# 模式3数据处理功能 Spec

## Why
为了扩展现有数据处理能力，支持用户上传包含内嵌图片的异构 Excel 数据，并将其无缝集成到现有的 `processLocalize` 工作流中，同时优化图片处理效率。

## What Changes
- **新增** 前端中间件 `lib/middleware-mode3.ts`：负责提取 Excel 内嵌图片，提前上传至 Cloudflare R2，并将英文表头映射为标准中文表头，生成兼容模式 1 的纯文本 File 对象。**此中间件将实现并发控制（例如，每次最多并行上传 5 张图片），并通过回调函数向 UI 反馈“图片提取与预上传”的进度。**
- **修改** `src/app/page.tsx`：升级上传入口，让模式 3 的文件先通过新建的中间件处理，再进入 `processLocalize`。
- **修改** 后端 `api/localize/finalize/route.ts`：增加对自有 R2 域名的识别，实现隐式跳过图片抓取，提高处理效率。

## Impact
- 受影响的规格：数据处理、图片处理、文件上传流程。
- 受影响的代码：`src/app/page.tsx`，`api/localize/finalize/route.ts`，新增文件 `lib/middleware-mode3.ts`。

## ADDED Requirements
### Requirement: 模式3数据转换中间件
系统 **SHALL** 提供一个前端中间件 `parseMode3Middleware`，用于处理异构 Excel 文件。

#### Scenario: 成功处理异构 Excel 文件
- **WHEN** 用户上传包含内嵌图片和非标准表头的 Excel 文件
- **THEN** 中间件 **SHALL** 提取内嵌图片并上传至 Cloudflare R2，将英文表头映射为标准中文表头，并返回一个兼容 `processLocalize` 的 `File` 对象。**中间件应实现并发控制以避免 UI 假死，并实时向 `localizeStatus` 反馈图片处理进度。**

### Requirement: 模式3上传入口集成
系统 **SHALL** 修改前端 `page.tsx` 中的模式 3 上传逻辑。

#### Scenario: 用户上传模式3文件
- **WHEN** 用户通过模式 3 的上传入口选择文件
- **THEN** 文件 **SHALL** 首先经过 `parseMode3Middleware` 处理，然后将处理后的 `File` 对象传递给 `processLocalize`，并跳过确认弹窗直接保存到库。

### Requirement: 后端R2域名智能放行
系统 **SHALL** 在后端 `api/localize/finalize/route.ts` 中增加逻辑，识别已上传至自有 R2 域名的图片链接。

#### Scenario: 处理包含R2链接的图片
- **WHEN** 后端 `finalize` 接口处理图片链接时，发现链接已包含自有 R2 域名
- **THEN** 后端 **SHALL** 跳过对该图片的抓取和重新上传，直接使用现有 R2 链接。

## MODIFIED Requirements
### Requirement: `parseMode3Middleware` 中的图片与数据行匹配
**在 `parseMode3Middleware` 中，匹配提取的图片与数据行时，** **SHALL** **严格测试 `exceljs` 的行号偏移量，确保 `Product Name` 与 `Image` 绝对对应，必要时使用 `console.log` 打印前三行的匹配结果进行校验，以避免因 `exceljs` 0-indexed 和 `worksheet.eachRow` 1-indexed 差异导致的错位。**

### Requirement: `/api/library/upload-image/route.ts` 的 FormData 解析
**在编写 `/api/library/upload-image/route.ts` 时，** **SHALL** **注意使用 `const formData = await request.formData()` 和 `const file = formData.get('file') as File`，并正确将 `file.arrayBuffer()` 转换为 `Node.js` 的 `Buffer` 后再调用 `R2` 上传工具。**