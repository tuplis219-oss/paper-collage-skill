---
name: paper-collage
description: 将用户照片合成为纸张拼贴、手账风单张图片，提供八款 Canvas 样式、自适应纸色和可填写的文字区域。适用于照片纸艺风格处理；不负责整本相册排版或 PDF 装订。
---

# Paper Collage · 纸艺拼贴

优先使用 `src/paper-collage.js` 进行 Canvas 2D 合成。代码无运行依赖，通过 `PaperCollage` 暴露 API，需要具备 DOM 和 Canvas 2D 的浏览器运行环境。具体调用见 [README.md](README.md)。

## 处理原则

- 保留输入照片的宽高比。通常只设置 `maxSide`，不要同时强制指定宽高。
- 使用原图像素合成，保留照片可见区域的人物和物体。模板会覆盖、分割、淡化或局部裁取照片，并不等于整张照片完全无遮挡。
- 默认不添加文字。便签、纸条、书页及框边保持空白，横线本仅保留横线。用户明确提供文字时，再使用 `drawText`。
- 只添加所选模板定义的纸层、框、孔洞、拼块或胶带，不自由添加植物、贴纸、人物等装饰。
- 照片内容优先时，优先考虑 `bottom_strip`，并检查纸条是否遮住主体。图像分析只有颜色、亮度等统计，没有人脸识别或主体识别。
- 未指定配色时使用 `palette: 'auto'`。`opacity` 是纸层不透明度，结构性留白背景不受其控制。

## 选择样式

八款样式及对应参考图见 [references/styles.md](references/styles.md)：

| 样式 ID | 名称 |
| --- | --- |
| `frame_window` | 纸框开窗 |
| `split_card` | 留白卡片 |
| `frame_polaroid` | 复古相片 |
| `notebook` | 横线本 |
| `book_overlay` | 摊开的书 |
| `circle_holes` | 圆形打孔 |
| `jigsaw` | 拼图 |
| `bottom_strip` | 底部纸条 |

用户指定样式时遵从其选择。批量处理时，每张照片各生成一张独立图片：

- 按照片自动选样式：直接调用 `renderBatch`，可能重复。
- 需要多样化：先调用 `pickTemplates(n, seed)`，再将结果传给 `renderBatch` 的 `templates` 参数。八款全部可用时，八张以内不重复；更多时循环分配，避免相邻重复。只允许一种样式时无法避免重复。
- 相同输入、参数和种子可复现；更换 `seed` 可改变孔洞、拼图等细节。

## 输出检查

检查图片比例、主体遮挡、纸层纹理、透明度和参考样式是否符合要求。自动配色不保证每张照片都合适，必要时调整 `paperColor` 或 `opacity`。

同时保留 `layout`，其中 `text_regions` 给出可填写区域的像素坐标、相对坐标及阅读顺序。`circle_holes` 没有文字区域。填写文字前确保字体已加载，填写后检查溢出：当前 `drawText` 不返回剩余未显示文字，长文本需要主动缩短或调整字号。

交付实际图片，按需附上布局 JSON。不要把风格处理误当作整册相册排版。
