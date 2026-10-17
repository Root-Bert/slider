/**
 * Swallows the one click a pointer drag ends with (it must not select the thumbnail under the
 * pointer) – and nothing after it. The browser sends that click in the same task as the
 * pointerup, so the guard disarms itself on the next task: when the click never comes (it lands
 * on the row the pointer was captured by), a later one – Enter on a thumbnail – still works.
 */
export function createClickGuard(
  schedule: (disarm: () => void) => void = (disarm) => setTimeout(disarm),
) {
  let armed = false;
  return {
    /** A drag just ended: the click that follows is part of it. */
    armAfterDrag() {
      armed = true;
      schedule(() => {
        armed = false;
      });
    },
    /** A new press: whatever came before is over. */
    reset() {
      armed = false;
    },
    /** True for the click that ends a drag; reading it lets the next click through. */
    consume() {
      const swallowed = armed;
      armed = false;
      return swallowed;
    },
  };
}
