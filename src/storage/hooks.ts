/** Kroker som state-laget kaller uten å importere lagringsmodulen (unngår sirkulær avhengighet). */
export const majorChange: { fn: (reason: string) => void } = { fn: () => undefined };
