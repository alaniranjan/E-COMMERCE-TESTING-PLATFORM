import { Locator } from '@playwright/test';
import { parsePrice } from '../utils/priceUtils';

/** One line item on the cart or checkout overview page. */
export class CartItem {
  readonly name: Locator;
  readonly price: Locator;
  readonly quantity: Locator;
  readonly removeButton: Locator;

  constructor(readonly root: Locator) {
    this.name = root.getByTestId('inventory-item-name');
    this.price = root.getByTestId('inventory-item-price');
    this.quantity = root.getByTestId('item-quantity');
    this.removeButton = root.getByRole('button', { name: 'Remove' });
  }

  async getName(): Promise<string> {
    return (await this.name.innerText()).trim();
  }

  async getPrice(): Promise<number> {
    return parsePrice(await this.price.innerText());
  }

  async getQuantity(): Promise<number> {
    return Number(await this.quantity.innerText());
  }

  async remove(): Promise<void> {
    await this.removeButton.click();
  }
}
