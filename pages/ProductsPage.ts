import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { ProductCard } from '../components/ProductCard';

export type SortOption = 'az' | 'za' | 'lohi' | 'hilo';

export class ProductsPage extends BasePage {
  protected readonly path = '/inventory.html';
  readonly productItems: Locator;
  readonly sortDropdown: Locator;

  constructor(page: Page) {
    super(page);
    this.productItems = page.getByTestId('inventory-item');
    this.sortDropdown = page.getByTestId('product-sort-container');
  }

  async expectLoaded(): Promise<void> {
    await this.expectOnPage();
    await this.expectTitle('Products');
  }

  product(name: string): ProductCard {
    return new ProductCard(this.productItems.filter({ hasText: name }));
  }

  async getProductCount(): Promise<number> {
    return this.productItems.count();
  }

  async getAllNames(): Promise<string[]> {
    return (await this.page.getByTestId('inventory-item-name').allInnerTexts()).map((n) => n.trim());
  }

  async getAllPrices(): Promise<number[]> {
    const cards = await this.productItems.all();
    return Promise.all(cards.map((card) => new ProductCard(card).getPrice()));
  }

  async sortBy(option: SortOption): Promise<void> {
    await this.sortDropdown.selectOption(option);
  }

  async addToCart(...names: string[]): Promise<void> {
    for (const name of names) await this.product(name).addToCart();
  }

  async openProduct(name: string): Promise<void> {
    await this.product(name).openDetails();
  }

  async expectProductCount(count: number): Promise<void> {
    await expect(this.productItems).toHaveCount(count);
  }
}
