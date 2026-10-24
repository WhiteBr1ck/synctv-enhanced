import { nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";

export function useChatScroll(
  area: Ref<HTMLElement | undefined>,
  content: Ref<HTMLElement | undefined>
) {
  const following = ref(true),
    unread = ref(0);
  let frame = 0,
    userUntil = 0;
  const userScroll = () => {
    userUntil = performance.now() + 1000;
  };
  const scroll = () => {
    if (!following.value || !area.value) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!following.value || !area.value) return;
      area.value.scrollTop = area.value.scrollHeight;
    });
  };
  const onScroll = () => {
    if (!area.value || performance.now() > userUntil) return;
    following.value = area.value.scrollHeight - area.value.clientHeight - area.value.scrollTop < 64;
    if (following.value) unread.value = 0;
  };
  const changed = (newMessage = false) => {
    if (!following.value && newMessage) unread.value++;
    void nextTick(scroll);
  };
  const jump = () => {
    following.value = true;
    unread.value = 0;
    changed();
  };
  const observer = new ResizeObserver(scroll);
  watch(
    [area, content],
    ([element, child]) => {
      observer.disconnect();
      if (element) observer.observe(element);
      if (child) observer.observe(child);
    },
    { flush: "post" }
  );
  onBeforeUnmount(() => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  });
  return { following, unread, onScroll, changed, jump, userScroll };
}
