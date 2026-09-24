# StockLens

美股实时看盘 + AI 决策辅助桌面终端。Electron + React + TypeScript，一条命令打包成 Windows 安装包 / 便携版 exe。

---

## 功能

**行情看盘**
- 自选股实时报价（价格、涨跌幅、成交量、中文名称），可排序、增删
- 专业 K 线图（TradingView lightweight-charts）：蜡烛图 + 成交量副图 + MA5/10/20 均线，十字光标、缩放、自适应
- 8 种周期（1分 / 5分 / 15分 / 30分 / 1小时 / 日 / 周 / 月）× 10 种时间范围
- 报价头：昨收、今开区间、52 周区间、成交量、交易所、数据时间
- 代码/公司名搜索，带键盘上下选择

**AI 决策助手**（OpenAI 兼容协议，支持 OpenAI / DeepSeek / Moonshot / 自建网关）
- 盘面速读、技术面深度分析、新闻解读、智能选股四个一键任务
- 自由对话（保留上下文，可追问）
- 流式输出 + 停止生成
- **技术指标由主进程精确计算后喂给模型**（MA / RSI / MACD / ATR / 量比），不让模型自己算数——这是同类工具最常见的错误来源

**商业化**
- Ed25519 离线许可证：应用内只带公钥，私钥在发行方手里，可一机一码或通用授权
- 授权状态 / 到期天数 / 机器码一键复制
- API Key 用系统级加密（Windows DPAPI）落盘，界面只显示掩码

---

## 快速开始

```bash
npm install
npm run dev          # 开发模式（热重载）
npm run typecheck    # 类型检查（主进程 + 渲染进程）
npm run build        # 构建到 out/
```

### 打包 Windows exe

```bash
npm run dist:win     # 产出 NSIS 安装包 + 便携版
```

产物在 `release/<版本>/`：

| 文件 | 说明 |
| --- | --- |
| `StockLens-Setup-<版本>.exe` | 安装包，可选安装目录、创建桌面/开始菜单快捷方式 |
| `StockLens-Portable-<版本>.exe` | 便携版，双击即用，适合 U 盘分发 |
| `win-unpacked/` | 免安装目录，可直接压缩成 zip 分发 |

**在 Windows 上打包**：装好 Node 18+ 直接跑上面那条命令，无需额外依赖。

**在 Linux 上打包**：需要 wine（electron-builder 用它写 exe 的图标与版本资源）：

```bash
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install -y wine wine64 wine32:i386
rm -rf ~/.wine                       # 旧 prefix 架构不对时必须重建
XDG_RUNTIME_DIR=/tmp/xdg-runtime xvfb-run -a npm run dist:win
```

> 若 electron-builder 报 `rcedit-ia32.exe` 相关错误，说明系统只有 wine64。装上 `wine32:i386` 即可（NSIS 与 rcedit 都是 32 位程序）。

**用 CI 打包**：见 `.github/workflows/release.yml`，推 tag 自动在 Windows runner 上出包并附到 Release。

---

## 项目结构

```
src/
  shared/          主进程与渲染进程共享的类型契约（唯一真相来源）
    types.ts       Quote / Candle / AppSettings / LicenseState …
    api.ts         window.api 接口定义
    ipc.ts         IPC 通道名
  main/            主进程：网络、密钥、缓存、许可证都在这一侧
    index.ts       窗口与生命周期
    ipc.ts         IPC 路由（所有渲染层输入都当不可信数据校验）
    store.ts       配置持久化 + API Key 加密
    market/        行情适配器（按能力组降级链）
      types.ts     适配器接口 + 超时/重试/节流工具
      tencent.ts   腾讯财经 · 报价（一次多股）
      sina.ts      新浪财经 · 报价（备用）
      eastmoney.ts 东方财富 · K 线 + 搜索
      yahoo.ts     Yahoo Finance · 全能力兜底
      finnhub.ts   Finnhub · 需自备 Key
      index.ts     MarketService：能力路由 + 缓存 + 过期兜底
    ai/
      client.ts    OpenAI 兼容流式客户端（可取消）
      indicators.ts MA/RSI/MACD/ATR 精确计算
      prompts.ts   提示词工程
    license/       Ed25519 离线验签 + 机器码
  preload/         contextBridge 桥（渲染层拿不到任何 Node 能力）
  renderer/src/    React 界面
    components/    Toolbar / WatchList / QuoteHeader / ChartPanel / AiPanel / 设置 / 激活
    store/         zustand 状态
tools/
  make-icon.mjs    生成应用图标（零依赖手写 PNG）
  sign-license.mjs 许可证签发（发行方专用，私钥不入包）
```

---

## 签发许可证

```bash
node tools/sign-license.mjs --licensee "张三" --plan pro --days 365
node tools/sign-license.mjs --licensee "某某公司" --plan lifetime --machine A1B2-C3D4-E5F6-7890
```

- `--days` 省略或传 0 表示永久
- `--machine` 省略表示通用许可证（不绑设备）；机器码让客户在应用内「许可证激活」里复制
- 私钥在 `.keys/license-private.pem`（已 gitignore）。**这个文件绝不能进安装包、不能进仓库**，泄露等于授权体系失效
- 换发行方（重新生成密钥对）后，已发出的旧许可证全部失效

---

## 数据源与商用合规（**卖之前必读**）

应用默认走「智能」数据源，按能力自动降级：

| 能力 | 链路 |
| --- | --- |
| 报价 | 腾讯财经 → 新浪财经 → Yahoo |
| K 线 | 东方财富 → Yahoo |
| 搜索 | 东方财富 → Yahoo |
| 新闻 | Yahoo |

这套设计是为了可用性——单一数据源在国内网络环境下很容易整条链路挂掉（实测 Yahoo 常返回 429、东财请求过密会直接断 TLS）。

**但可用 ≠ 可商用。** 腾讯 / 新浪 / 东方财富 / Yahoo 的公开接口都是面向网页端用户的，其服务条款均未授权第三方商业分发；用它们做收费产品存在法律风险。真要售卖，请把默认源换成有商业授权的数据源，本项目已经预留好位置：

1. 在 `src/main/market/` 下新增一个实现 `MarketProvider` 的适配器
2. 在 `src/main/market/index.ts` 的 `chains()` 里把它排到对应能力的第一位

可选的商业授权源：Polygon.io、Finnhub 付费版、Alpha Vantage 商业版、Tiingo、IEX Cloud。国内合规渠道可考虑与持牌数据服务商合作。

---

## AI 配置

「设置 → AI 助手」里填：

| 字段 | 说明 |
| --- | --- |
| 服务商 | OpenAI / DeepSeek / Moonshot / 自定义 |
| Base URL | 任何 OpenAI 兼容端点，例如自建网关 `https://your-gateway/v1` |
| API Key | 本地加密保存，读取时只返回掩码 |
| 模型 | 例如 `gpt-4o-mini`、`deepseek-chat` |
| 温度 | 0 最保守，1 最发散；盘面分析建议 0.2–0.4 |

若要让客户开箱即用而不填 Key，可以自建一个中转网关，把 Key 放在网关侧——注意这时需要额外的用量控制与鉴权，否则会被刷。

---

## 已知边界

- 仅支持美股；港股/A 股需另接适配器
- 实时性取决于数据源，非交易所直连，不适合做高频/套利决策
- 打包产物未做代码签名，Windows SmartScreen 会提示"未知发布者"。正式售卖建议购买代码签名证书（OV/EV），在 `electron-builder.yml` 里配 `certificateFile` / `certificatePassword`
- AI 输出仅供研究参考，不构成投资建议；界面上已固定展示该提示
