import { useEffect, useRef } from "react";

/**
 * 用户空闲检测Hook
 * 监听用户的鼠标、键盘等交互事件，连续 timeoutMs 无操作时调用 onIdle。
 * 活动时间只写 ref、用单个 setTimeout 判定，不会因为鼠标移动或计时触发重渲染。
 */
export function useIdleTimeout(timeoutMs: number, onIdle: () => void) {
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    let lastActivity = Date.now();
    let timer: ReturnType<typeof setTimeout>;

    const check = () => {
      const remaining = timeoutMs - (Date.now() - lastActivity);
      if (remaining <= 0) {
        onIdleRef.current();
        return;
      }
      timer = setTimeout(check, remaining);
    };

    const updateActivity = () => {
      lastActivity = Date.now();
    };

    // scroll 不冒泡，用捕获阶段才能收到内部面板的滚动
    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "click", "wheel"];
    events.forEach((event) => {
      window.addEventListener(event, updateActivity, { passive: true, capture: true });
    });
    timer = setTimeout(check, timeoutMs);

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, updateActivity, { capture: true });
      });
      clearTimeout(timer);
    };
  }, [timeoutMs]);
}
