/** Stable names in the public AG-UI progress projection. */
export const nativeAgUiStepLabels = {
  foreground: "正在理解问题",
  "research-queued": "研究任务已排队",
  "research-executing": "正在执行研究",
  "discovery-wait": "正在等待发现服务",
  "source-read-wait": "正在等待读取来源",
  "workspace-wait": "正在等待原页面确认",
  "research-resuming": "正在继续原研究任务",
} as const;

export type NativeAgUiStep = keyof typeof nativeAgUiStepLabels;

export function nativeAgUiStepLabel(step: string): string | undefined {
  return Object.hasOwn(nativeAgUiStepLabels, step)
    ? nativeAgUiStepLabels[step as NativeAgUiStep]
    : undefined;
}
