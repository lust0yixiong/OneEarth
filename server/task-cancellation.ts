/** Only a persisted user cancellation may cancel delegated work. */
export class TaskCancelled extends Error {
  constructor() {
    super("任务已取消。");
    this.name = "TaskCancelled";
  }
}
