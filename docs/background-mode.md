# Background monitoring with tray controls

OpenAware v0.4 retains the background controls introduced in v0.2: it can hide its dashboard while configured capture and awareness sessions continue. Headless means a hidden dashboard with a system tray in the same interactive Windows desktop session. Sources and native permissions remain attached to that session.

## Configure, then hide

1. Open the dashboard and choose the feeds you want to observe. For a screen, click **Add source**, choose **Monitor**, select the screen, then click **Connect source** in the dialog. This adds the source and starts its preview. Repeat for your other monitor. Capture starts only after this explicit selection and connection.
2. For AI monitoring, select an agent, assign its Feeds, configure LM Studio, Ollama or llama.cpp in Connections, select a vision model, and pass the displayed synthetic vision test. Repeat for any other agents. For motion-only monitoring, disable AI analysis and enable Motion alerts on the relevant sources.
3. Start each desired agent watching. Live preview requires neither a model nor this button; connecting the source starts its preview.
4. Click **Background** in the top bar. The existing dashboard is hidden; its source pipelines and current session continue.
5. Use the OpenAware system-tray menu to show the dashboard, stop the session, or quit.

Entering background mode does not start monitoring, select another source or model, or grant computer-action permission. Operator steps still require the same native review and approval for every step. Video player windows remain separate from the dashboard; they can be minimized, and closing one disconnects its feed.

The dashboard is one workspace with each source, chat, activity and lower Agent desk in an independent pane. Two monitor panes default to side by side; additional desktop/video panes use two-column rows, with cameras below. Default feed heights fit video proportions. Additional monitor rows grow into the lower space; the desk occupies the remainder below the feed group. The assistant/activity sidebar uses a 75%/25% split. Operator is a separate page in the top navigation. Drag handles, Arrange icon menus and dividers change the layout. Global Reset, source-list changes and returning to Overview restore defaults. Hiding or showing the existing dashboard preserves its layout and live connections. The shared library holds sixteen sources, with four assigned feeds per agent and up to four agents. Layout controls do not change capture/model permissions.

## Controls and window behavior

| Control                                                         | Result                                                                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Background** in the dashboard                                 | Enables background mode and hides the dashboard; the current session continues.                                                               |
| Tray **Show OpenAware** or double-click                         | Shows the dashboard and preserves the background preference. Closing this shown window hides it again.                                        |
| **Window mode** in the dashboard                                | Clears the background preference and shows the dashboard. Closing the window now quits.                                                       |
| Tray **Keep running in background**                             | Enables or clears the same background preference. Enabling hides the window; clearing shows it.                                               |
| **Stop all** or tray **Stop all capture and actions**           | Releases selected capture tracks, cancels pending inference, and revokes pending action authority. The application and tray remain available. |
| **Quit OpenAware**, tray **Quit**, or application menu **Quit** | Stops the session, closes the awareness service, removes the tray, and exits in either mode.                                                  |

Ctrl+Shift+F12 invokes Stop when the global shortcut registers successfully. Stop cannot undo an input event already sent. Stopped feeds require an explicit reconnect; they do not resume merely because you show the dashboard.

## Start directly in the tray

From the directory containing the packaged executable, choose either command:

```powershell
.\OpenAware.exe --background
```

```powershell
.\OpenAware.exe --headless
```

Both flags start an **idle** tray session. No source is selected, no model is bound, and no monitoring begins automatically. Use **Show OpenAware** to configure the session. Showing the dashboard preserves the background preference; use **Window mode** when you want closing the window to quit.

For a source checkout, build first and use one of the same flags:

```powershell
npm run build
npx electron . --background
```

`--headless` is an alias for this tray lifecycle. The dashboard remains available through **Show OpenAware**.

## Lifetime and limits

Source configuration, model binding, tokens, observations, conversation, and events are memory only. Quit or restart discards the session; there is no automatic source restoration or persisted background preference. Background mode does not install a Windows service or configure automatic startup. Windows sign-out ends the interactive session; lock, sleep, device removal, and recovery on real hardware still require live acceptance testing.

Production background mode requires an available system tray. If tray creation fails, the dashboard remains visible and background mode is disabled. Service failure stops the current session and reveals the error in the dashboard rather than silently restarting feeds.

Synthetic Electron tests verify continued frame acquisition and mock inference while hidden, Show and close behavior, idle headless startup, and process termination after Quit. A production tray test verifies the real menu and its installed callbacks. Version 0.2.1 adds a controlled two-window regression for real display acquisition; results are recorded in its ledger. Personal monitor and mixed-DPI capture, real cameras/models, physical tray clicks, and native input effects still require acceptance evidence. See [prototype status](prototype.md), the [v0.2.1 implementation ledger](../.omx/logs/implementation-v0.2.1.md), and the historical [v0.2 ledger](../.omx/logs/implementation-v0.2.md).

Version 0.2.1 uses a transparent blue OpenAware eye/O icon in the Windows tray, with a tooltip naming OpenAware and its capture state. If Windows places it in the overflow, open the taskbar **^**, find the blue eye, and right-click **Show OpenAware** or double-click the icon.

Current Overview and release verification status is recorded in the [v0.2.4 implementation ledger](../.omx/logs/implementation-v0.2.4.md). The [v0.2.3 implementation ledger](../.omx/logs/implementation-v0.2.3.md) preserves the earlier flat-workspace checks.
