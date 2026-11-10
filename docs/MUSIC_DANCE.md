# 桌面音乐舞动

## 范围

首个版本只面向 Windows Electron 桌宠和已加载的 VRM 角色。用户主动点击“音乐舞动”后，应用通过 Electron 系统音频回环取得当前输出混音，在内存中分析低频能量与节拍并驱动程序化舞步。`getDisplayMedia` 要求同时申请屏幕视频和系统音频；Electron 提供可信窗口的屏幕源，渲染端拿到流后立即关闭视频轨，不显示、处理或保存画面。原始音频不写盘、不上传，也不用于识别歌曲或歌词。桌宠隐藏、音轨结束或用户停止时关闭采集。

精灵图必须具有对应舞蹈帧才可表现舞蹈；现有图集没有额外舞蹈状态，所以首版不为精灵图生成假舞步。ChatGPT 宠物运行在宿主环境，不能访问用户电脑的系统混音，本功能不延伸至宿主内。

## 开发阶段

1. **本机采集与分析**：通过 Electron [`setDisplayMediaRequestHandler`](https://www.electronjs.org/docs/latest/api/session) 只授权可信、可见应用窗口发起的用户手势请求，使用 `desktopCapturer` 提供临时视频源并返回 Windows loopback 音频；`getDisplayMedia` 不允许 `video: false`，所以渲染端取得流后立即停止视频轨。随后使用 Web Audio `AnalyserNode` 计算低频能量、节拍脉冲和滚动 BPM；只取分析数值，不保留 PCM 或频谱缓存。Windows 的捕获路径基于 [WASAPI loopback](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording)。
2. **VRM 程序化舞步**：按检测到的 BPM、强度和节拍脉冲调整身体摆动、手臂、腿部和弹跳；静音时回到普通状态。手动挥手、对话动作与动作优先级后续在体验中调整。
3. **舞蹈动作源**：评估桌宠加载用户提供 VRMA 并随音乐节拍/小节切换的接口；需要避免音乐跳转、变速导致动作不连续。
4. **其他角色格式**：以后提供带舞蹈帧的精灵图模板；验证素材许可与 ChatGPT 图集格式后再考虑图集适配。

## 当前实现边界

- 目前已加入 Windows loopback 请求门控、用户点击开关、内存节拍分析，以及空闲状态下的 VRM 程序化舞姿；聊天和手动动作优先。系统音频流所需的视频轨取得后立即关闭，应用不呈现屏幕画面。
- `npm run build` 通过。测试、Windows EXE 打包、系统音频设备和实际歌曲体验尚未运行；节拍检测可能受低音量、强压缩或非稳定节拍音乐影响。
- 开关默认关闭，每次需要用户主动开启；窗口隐藏时停止采集。
- 不提供全局音量录制、歌曲识别、歌词分析或音频上传。
