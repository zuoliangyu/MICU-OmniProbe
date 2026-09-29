import { useState } from "react";

/** open 第一次为 true 后一直返回 true。在渲染期更新是 React 认可的「由 props 派生 state」写法。 */
export function useMountedAfterOpen(open: boolean) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  return mounted || open;
}
