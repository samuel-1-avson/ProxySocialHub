import type { Locator } from '@playwright/test';

/** Set value on a React controlled <input> so onChange state updates reliably in E2E. */
export async function fillReactInput(input: Locator, value: string) {
    await input.click();
    await input.evaluate((el, nextValue) => {
        const node = el as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(node, nextValue);
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
}
