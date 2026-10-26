# 工地打卡（原型）

给澳洲小包工头和工人用的打卡 App：Expo (React Native + TypeScript)，同时支持 iOS / Android。界面为简体中文，文案集中在 `src/i18n.ts`，以后加英文只需新增一份同结构的词典。

## 运行
```bash
npm install
npx expo start
```
用手机装 **Expo Go**，扫描终端里的二维码即可（iOS 用相机扫，Android 用 Expo Go 内扫码）。
网页预览：`npx expo export --platform web`，产物在 `dist/`（用 `npx serve dist` 打开）。
类型检查：`npx tsc --noEmit`。需要 Node ≥ 22.13（Node 20 能跑，但会有警告）。

## 功能
- 首次启动选 **老板 / 工人**。老板创建团队得到 6 位团队码；工人输入团队码 + 姓名加入。
- 工人：大按钮 上班/下班打卡，记录时间、GPS、可选拍照，显示今日工时。断网时先存在本机队列，联网自动同步。
- 老板：工人列表（谁在岗）、周工时表（可翻周）、休息扣除设置（默认班次超过 5 小时扣 30 分钟）、导出 CSV（Excel 可直接打开）。

## 数据层
UI 只通过 `src/data.ts` 的 `DataSource` 接口读写数据。目前是 AsyncStorage 本地实现，**数据只存在当前手机，老板和工人在不同手机上看不到彼此的数据**。
接入 Supabase：按接口写一个 `DataSource` 实现（`addPunch` 先入本地队列，`sync()` 上传），把 `data.ts` 最后一行 `export const data` 换掉即可。表结构和行级安全草案见 `supabase/schema.sql`（现在不需要运行）。

## 未做
真正的多手机同步、登录/防作弊（定位围栏、防改时间）、照片上传、后台定位、App 商店打包（`eas build`）。
