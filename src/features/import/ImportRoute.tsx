import { useState } from "react";
import { useRouter } from "~/app/router";
import { Toast, type ToastSpec } from "~/ui";
import { ImportPage } from "./ImportPage";

/**
 * Wraps the import sheet as a route, so it is linkable from Settings and gets a real back
 * button rather than being trapped inside another screen's state.
 */
export function ImportRoute() {
  const { navigate } = useRouter();
  const [toast, setToast] = useState<ToastSpec | null>(null);

  return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <ImportPage
        onClose={(spec) => {
          if (spec) setToast(spec);
          // Back to history, where the freshly imported rows are visible immediately.
          navigate("/history");
        }}
      />
      {toast && <Toast spec={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
