# OneEarth 品牌素材

本仓库使用设计主目录 `OneEarth/素材/视觉VI/` 中的正式包 `OneEarth-A02-VI-System-v1.3-2026-11-06`。该版保留 A02 定稿图形与字标，增加 v15 线稿。下表中的组合、字标、线稿和 ICO 均已和母版逐字节核对。GitHub 深色与浅色主题分别使用对应的官方透明底主组合。

| 场景 | 仓库资源 | 母版内位置 |
| --- | --- | --- |
| 浅色页头、关于、设置及 README | [浅色主组合](OneEarth-lockup-light-transparent@1x.png) | `02-Brand-Assets/02-Lockups/PNG/` |
| GitHub 深色主题 | [深色主组合](OneEarth-lockup-dark-transparent@1x.png) | 同上 |
| Chat 答复署名 | [黑字红笔字标](OneEarth-wordmark-black-red.svg) | `02-Brand-Assets/03-Wordmarks/SVG/` |
| 小尺寸应用图标 | [OneEarth.ico](OneEarth.ico)、[网站 ICO](../favicon.ico)、[16 px](OneEarth-favicon-16.png)、[32 px](OneEarth-favicon-32.png)、[触屏图标](../apple-touch-icon.png) | `02-Brand-Assets/04-App-Icons/OneEarth.ico`。两个 ICO 内容相同，三个 PNG 分别是该 ICO 内的 16、32 和 256 px 原始帧 |
| 缺图的数据卡片、大尺寸线稿展示 | [512 px 黑线稿](OneEarth-A02-line-refine-v15-black-512.png)、[横排线稿](OneEarth-v15-horizontal-light.svg) | `02-Brand-Assets/06-Line-Art-v15/{PNG,Lockups}/` |

使用原比例与配套背景。小图标使用实心 A02，v15 线稿独立图形用于 128 px 及以上场景。产品标语为「让地球可被理解和计算」。目录中的历史动效文件不作为静态标识母版。

从仓库根目录运行 `shasum -a 256 -c public/brand/SHA256SUMS` 可复核十个发布文件。品牌升级时，在同一 PR 提供正式包名称、版本、使用场景以及新旧视觉对照，更新引用及[校验清单](SHA256SUMS)。
