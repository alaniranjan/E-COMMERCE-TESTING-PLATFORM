import { Locator, Page, expect } from '@playwright/test';
import { Header } from '../components/Header';

/** Common behaviour for all pages: relative navigation, page title, shared header. */
export abstract class BasePage {
  /** Path relative to BASE_URL, e.g. "/inventory.html". */
  protected abstract readonly path: string;
  readonly header: Header;
  readonly title: Locator;

  constructor(protected readonly page: Page) {
    this.header = new Header(page);
    this.title = page.getByTestId('title');
  }

  async goto(): Promise<void> {
    await this.page.goto(this.path);
  }

  async expectOnPage(): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`${escapeRegExp(this.path)}$`));
  }

  async expectTitle(text: string): Promise<void> {
    await expect(this.title).toHaveText(text);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
