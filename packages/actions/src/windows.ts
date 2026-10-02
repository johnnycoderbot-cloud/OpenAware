import { spawn } from "node:child_process";
import { join } from "node:path";
import type { AutomationStep } from "../../contracts/src/index";
import type { Inspection, Point, Rect } from "./index";

// Constant code only. Model text is sent as JSON through stdin, never interpolated into shell code.
// Win32 references: https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-sendinput
// https://learn.microsoft.com/windows/win32/api/winuser/ns-winuser-mouseinput
export const WINDOWS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class OpenAwareInput {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out RECT value, int size);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  public static long Target(bool click, int x, int y) {
    if (SetThreadDpiAwarenessContext(new IntPtr(-4)) == IntPtr.Zero) throw new Exception("Per-monitor DPI context unavailable");
    IntPtr window = click ? GetAncestor(WindowFromPoint(new POINT { x=x, y=y }), 2) : GetForegroundWindow();
    return window.ToInt64();
  }
  public static string Title(long handle) { var text = new StringBuilder(512); GetWindowText(new IntPtr(handle), text, 512); return text.ToString(); }
  public static uint Owner(long handle) { uint owner; GetWindowThreadProcessId(new IntPtr(handle), out owner); return owner; }
  public static int[] Bounds(long handle) { RECT rect; if (DwmGetWindowAttribute(new IntPtr(handle),9,out rect,Marshal.SizeOf(typeof(RECT))) != 0 && !GetWindowRect(new IntPtr(handle),out rect)) throw new Exception("Window disappeared"); return new int[] { rect.left, rect.top, rect.right-rect.left, rect.bottom-rect.top }; }
  private static INPUT Key(ushort key, ushort scan, uint flags) { return new INPUT { type=1, u=new UNION { ki=new KEYBDINPUT { wVk=key, wScan=scan, dwFlags=flags } } }; }
  public static void Apply(string operation, int x, int y, string text, string key) {
    var list = new System.Collections.Generic.List<INPUT>();
    if (operation == "click") {
      int left=GetSystemMetrics(76), top=GetSystemMetrics(77), width=GetSystemMetrics(78), height=GetSystemMetrics(79);
      if (width <= 1 || height <= 1 || x<left || x>=left+width || y<top || y>=top+height) throw new Exception("Point outside virtual desktop");
      int nx=(int)Math.Round((x-left)*65535.0/(width-1)), ny=(int)Math.Round((y-top)*65535.0/(height-1));
      list.Add(new INPUT { type=0, u=new UNION { mi=new MOUSEINPUT { dx=nx, dy=ny, dwFlags=0xC001 } } });
      list.Add(new INPUT { type=0, u=new UNION { mi=new MOUSEINPUT { dwFlags=2 } } });
      list.Add(new INPUT { type=0, u=new UNION { mi=new MOUSEINPUT { dwFlags=4 } } });
    } else if (operation == "type") {
      if (String.IsNullOrEmpty(text) || text.Length>1000) throw new Exception("Invalid text length");
      foreach (char character in text) { if (char.IsControl(character)) throw new Exception("Control text denied"); list.Add(Key(0,character,4)); list.Add(Key(0,character,6)); }
    } else if (operation == "key") {
      bool ctrl=key.StartsWith("CTRL+"); string name=ctrl ? key.Substring(5) : key; ushort vk;
      switch(name) { case "ENTER":vk=13;break; case "TAB":vk=9;break; case "ESC":vk=27;break; case "BACKSPACE":vk=8;break; case "UP":vk=38;break; case "DOWN":vk=40;break; case "LEFT":vk=37;break; case "RIGHT":vk=39;break; case "A":case "C":case "V":case "Z": if(!ctrl)throw new Exception("Key denied");vk=name[0];break; default:throw new Exception("Key denied"); }
      if(ctrl)list.Add(Key(17,0,0)); list.Add(Key(vk,0,0)); list.Add(Key(vk,0,2)); if(ctrl)list.Add(Key(17,0,2));
    } else throw new Exception("Operation denied");
    var inputs=list.ToArray(); uint sent=SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)));
    if(sent!=inputs.Length) throw new Exception("Windows did not accept all input; outcome unknown (UIPI may block elevated apps)");
  }
}
'@
$isClick = $request.step.type -eq 'click'
$x = 0; $y = 0
if ($isClick) { $x=[int]$request.point.x; $y=[int]$request.point.y }
$target = [OpenAwareInput]::Target($isClick,$x,$y)
if ($target -eq 0) { throw 'No target window' }
$title = [OpenAwareInput]::Title($target)
$owner = [OpenAwareInput]::Owner($target)
if ($owner -eq [uint32]$request.rejectProcessId) { throw 'Actions targeting OpenAware are denied' }
$bounds = [OpenAwareInput]::Bounds($target)
if (!$isClick) {
  if ($bounds[0] -lt $request.bounds.x -or $bounds[1] -lt $request.bounds.y -or ($bounds[0]+$bounds[2]) -gt ($request.bounds.x+$request.bounds.width) -or ($bounds[1]+$bounds[3]) -gt ($request.bounds.y+$request.bounds.height)) { throw 'Keyboard target must be wholly on the selected monitor' }
}
if ($request.mode -eq 'inspect') {
  @{ window=$target.ToString(); title=$title } | ConvertTo-Json -Compress
} elseif ($request.mode -eq 'effect') {
  if ($target.ToString() -ne $request.expectedWindow -or $title -ne $request.expectedTitle) { throw 'Native target changed before input' }
  if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [long]$request.deadline) { throw 'Native inspection deadline expired' }
  [OpenAwareInput]::Apply([string]$request.step.type,$x,$y,[string]$request.step.text,[string]$request.step.key)
  '{"sent":true}'
} else { throw 'Mode denied' }
`;

interface NativeRequest {
  mode: "inspect" | "effect";
  step: AutomationStep;
  point?: Point;
  bounds: Rect;
  rejectProcessId: number;
  expectedWindow?: string;
  expectedTitle?: string;
  deadline?: number;
}
export function runWindows<T>(
  request: NativeRequest,
  signal: AbortSignal,
): Promise<T> {
  if (process.platform !== "win32")
    return Promise.reject(
      new Error("Native actions currently require Windows"),
    );
  if (signal.aborted) return Promise.reject(new Error("Actions stopped"));
  const executable = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    let errors = "";
    let settled = false;
    const finish = (error?: Error, value?: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value!);
    };
    const abort = (): void => {
      child.kill();
      finish(new Error("Actions stopped; input outcome may be unknown"));
    };
    // A monotonic Node timer also bounds input when the wall clock changes.
    const budget =
      request.mode === "effect"
        ? Math.max(
            1,
            Math.min(2000, (request.deadline ?? Date.now()) - Date.now()),
          )
        : 5000;
    const timer = setTimeout(() => {
      child.kill();
      finish(
        new Error("Native worker timed out; input outcome may be unknown"),
      );
    }, budget);
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 8192) {
        child.kill();
        finish(new Error("Native response too large"));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-4000);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(
          new Error(
            errors.replace(/<[^>]+>/g, "").slice(0, 300) ||
              "Native input failed",
          ),
        );
        return;
      }
      try {
        finish(undefined, JSON.parse(output.trim()) as T);
      } catch {
        finish(new Error("Invalid native worker response"));
      }
    });
    child.stdin.on("error", (error) => finish(error));
    child.stdin.end(JSON.stringify(request));
  });
}
export async function inspectWindowsTarget(
  step: AutomationStep,
  bounds: Rect,
  point: Point | undefined,
  signal: AbortSignal,
): Promise<{ window: string; title: string }> {
  const result = await runWindows<{ window: string; title: string }>(
    { mode: "inspect", step, point, bounds, rejectProcessId: process.pid },
    signal,
  );
  if (
    !/^\d+$/.test(result.window) ||
    typeof result.title !== "string" ||
    result.title.length > 512
  )
    throw new Error("Invalid native target identity");
  return result;
}
export async function applyWindowsStep(
  step: AutomationStep,
  inspection: Inspection,
  deadline: number,
  signal: AbortSignal,
): Promise<void> {
  const result = await runWindows<{ sent: boolean }>(
    {
      mode: "effect",
      step,
      point: inspection.point,
      bounds: inspection.bounds,
      rejectProcessId: process.pid,
      expectedWindow: inspection.targetWindow,
      expectedTitle: inspection.targetTitle,
      deadline,
    },
    signal,
  );
  if (result.sent !== true) throw new Error("Windows input was not confirmed");
}
