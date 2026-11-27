import { classifyError } from "./recovery/error-classifier.ts";

export function isTransientTaskError(category: string, status?: number) {
  if (status === 429 || (status !== undefined && status >= 500) || category === "timeout") {
    return true;
  }
  const classified = classifyError({ message: category, status });
  return classified.isTransient;
}
