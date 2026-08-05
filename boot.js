/* ExamFlow boot loader
   - Không cho Jitsi hoặc CDN bên ngoài chặn nút đăng nhập.
   - Hiển thị lỗi rõ ràng nếu renderer/Firebase không tải được.
   - Tự thử lại khi người dùng bấm Đăng nhập. */
(() => {
  "use strict";

  const loginButton = document.getElementById("btn-login");
  const toast = document.getElementById("toast");
  const warning = document.getElementById("cfg-warn");
  const warningClose = document.getElementById("cfg-warn-close");

  let state = "idle"; // idle | loading | ready | failed
  let attempt = 0;
  let pendingLogin = false;
  let lastError = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showBootMessage(message, ok = false) {
    if (!toast) return;
    toast.innerHTML = `<span class="toast-icon">${ok ? "✓" : "!"}</span><span class="toast-copy">${escapeHtml(message)}</span>`;
    toast.className = `toast ${ok ? "ok" : "err"}`;
    toast.classList.remove("hidden");
    clearTimeout(toast._bootTimer);
    toast._bootTimer = setTimeout(() => toast.classList.add("hidden"), 5200);
  }

  function setButtonBooting(on) {
    if (!loginButton || state === "ready") return;
    if (on) {
      if (!loginButton.dataset.bootOrigHtml) loginButton.dataset.bootOrigHtml = loginButton.innerHTML;
      loginButton.classList.add("is-loading");
      loginButton.innerHTML = '<span class="button-spinner" aria-hidden="true"></span><span>Đang khởi động…</span>';
    } else {
      loginButton.classList.remove("is-loading");
      loginButton.disabled = false;
      loginButton.innerHTML = loginButton.dataset.bootOrigHtml || 'Đăng nhập <span>→</span>';
      delete loginButton.dataset.bootOrigHtml;
    }
  }

  function showFatalBootError(error) {
    const detail = error?.message || String(error || "Không xác định");
    if (warning) {
      warning.classList.remove("hidden");
      const isCodeError = error instanceof SyntaxError || /already been declared|Unexpected token|Identifier/i.test(detail);
      warning.innerHTML = isCodeError
        ? `⚠️ Ứng dụng có lỗi JavaScript nên chưa thể khởi động.<br><small>${escapeHtml(detail)}</small> <a id="cfg-warn-close">✕</a>`
        : `⚠️ Không tải được hệ thống đăng nhập. Kiểm tra Internet rồi bấm <strong>Đăng nhập</strong> để thử lại.<br><small>${escapeHtml(detail)}</small> <a id="cfg-warn-close">✕</a>`;
      warning.querySelector("#cfg-warn-close")?.addEventListener("click", () => warning.classList.add("hidden"));
    }
    const isCodeError = error instanceof SyntaxError || /already been declared|Unexpected token|Identifier/i.test(detail);
    showBootMessage(isCodeError
      ? "Không khởi động được ứng dụng do lỗi JavaScript. Hãy dùng bản đã sửa mới nhất."
      : "Không tải được Firebase. Kiểm tra Internet rồi bấm Đăng nhập để thử lại.");
  }

  async function boot() {
    if (state === "loading" || state === "ready") return;
    state = "loading";
    attempt += 1;
    lastError = null;

    try {
      // Query khác nhau cho mỗi lần thử để trình duyệt không giữ lỗi import cũ.
      const cacheKey = `${Date.now()}_${attempt}`;
      await import(`./renderer.js?examflow_boot=${cacheKey}`);

      window.__EXAMFLOW_ADMIN_READY__ = Boolean(window.ExamFlowAdmin);

      try {
        await import(`./platform-upgrade.js?examflow_boot=${cacheKey}`);
        window.__EXAMFLOW_NEXUS_READY__ = true;
      } catch (upgradeError) {
        console.error("ExamFlow Nexus upgrade error:", upgradeError);
        window.__EXAMFLOW_NEXUS_READY__ = false;
        window.__EXAMFLOW_NEXUS_ERROR__ = upgradeError;
        showBootMessage("Đăng nhập vẫn hoạt động, nhưng mô-đun Nexus chưa tải được. Hãy kiểm tra Internet rồi khởi động lại.");
        const openLegacyFallback = () => {
          const role = window.ExamFlowCore?.currentRole;
          if (!role) return;
          const pageId = role === "giaovien" ? "page-hoc-phan" : "page-ghi-danh";
          const navItem = document.querySelector(`.nav-item[data-page="${pageId}"]`);
          if (navItem) navItem.click();
          else window.ExamFlowCore?.setPage?.(pageId);
        };
        document.addEventListener("examflow:workspace-opened", openLegacyFallback, { once: true });
        setTimeout(openLegacyFallback, 0);
      }
      state = "ready";
      window.__EXAMFLOW_READY__ = true;
      warning?.classList.add("hidden");
      setButtonBooting(false);

      if (pendingLogin && loginButton) {
        pendingLogin = false;
        requestAnimationFrame(() => loginButton.click());
      }
    } catch (error) {
      console.error("ExamFlow boot error:", error);
      lastError = error;
      state = "failed";
      window.__EXAMFLOW_READY__ = false;
      setButtonBooting(false);
      showFatalBootError(error);
    }
  }

  function guardLoginClick(event) {
    if (state === "ready") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pendingLogin = true;
    setButtonBooting(true);

    if (state === "failed" || state === "idle") boot();
    else showBootMessage("Hệ thống đang khởi động, vui lòng chờ vài giây.", true);
  }

  loginButton?.addEventListener("click", guardLoginClick, true);
  warningClose?.addEventListener("click", () => warning?.classList.add("hidden"));

  // Khởi động ngay nhưng không khóa nút. Nếu người dùng bấm sớm, thao tác sẽ
  // tự tiếp tục ngay sau khi Firebase tải xong.
  boot();

  // Sau 12 giây mà mô-đun vẫn chưa sẵn sàng thì hiện thông báo thay vì im lặng.
  setTimeout(() => {
    if (state === "loading") {
      showBootMessage("Firebase đang tải lâu. Kiểm tra kết nối Internet rồi thử lại.");
    }
  }, 12000);

  window.__EXAMFLOW_BOOT_DEBUG__ = () => ({ state, attempt, lastError });
})();
