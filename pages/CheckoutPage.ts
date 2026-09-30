import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { CartItem } from '../components/CartItem';
import { parsePrice } from '../utils/priceUtils';
import { CustomerInfo } from '../test-data/types';

export interface OrderSummary {
  itemTotal: number;
  tax: number;
  total: number;
}

/**
 * SauceDemo checkout spans three URLs (information -> overview -> complete).
 * They are one business flow, so one page object covers all three steps.
 */
export class CheckoutPage extends BasePage {
  protected readonly path = '/checkout-step-one.html';

  // Step one: customer information
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly postalCodeInput: Locator;
  readonly continueButton: Locator;
  readonly cancelButton: Locator;
  readonly errorMessage: Locator;

  // Step two: overview
  readonly overviewItems: Locator;
  readonly subtotalLabel: Locator;
  readonly taxLabel: Locator;
  readonly totalLabel: Locator;
  readonly paymentInfo: Locator;
  readonly shippingInfo: Locator;
  readonly finishButton: Locator;

  // Complete
  readonly completeHeader: Locator;
  readonly completeText: Locator;
  readonly backHomeButton: Locator;

  constructor(page: Page) {
    super(page);
    this.firstNameInput = page.getByTestId('firstName');
    this.lastNameInput = page.getByTestId('lastName');
    this.postalCodeInput = page.getByTestId('postalCode');
    this.continueButton = page.getByTestId('continue');
    this.cancelButton = page.getByTestId('cancel');
    this.errorMessage = page.getByTestId('error');

    this.overviewItems = page.getByTestId('inventory-item');
    this.subtotalLabel = page.getByTestId('subtotal-label');
    this.taxLabel = page.getByTestId('tax-label');
    this.totalLabel = page.getByTestId('total-label');
    this.paymentInfo = page.getByTestId('payment-info-value');
    this.shippingInfo = page.getByTestId('shipping-info-value');
    this.finishButton = page.getByTestId('finish');

    this.completeHeader = page.getByTestId('complete-header');
    this.completeText = page.getByTestId('complete-text');
    this.backHomeButton = page.getByTestId('back-to-products');
  }

  async expectLoaded(): Promise<void> {
    await this.expectOnPage();
    await this.expectTitle('Checkout: Your Information');
  }

  async fillCustomerInfo(info: Partial<CustomerInfo>): Promise<void> {
    if (info.firstName !== undefined) await this.firstNameInput.fill(info.firstName);
    if (info.lastName !== undefined) await this.lastNameInput.fill(info.lastName);
    if (info.postalCode !== undefined) await this.postalCodeInput.fill(info.postalCode);
  }

  async continue(): Promise<void> {
    await this.continueButton.click();
  }

  async submitCustomerInfo(info: Partial<CustomerInfo>): Promise<void> {
    await this.fillCustomerInfo(info);
    await this.continue();
  }

  async expectError(message: string): Promise<void> {
    await expect(this.errorMessage).toHaveText(message);
  }

  async expectOverviewLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/\/checkout-step-two\.html$/);
    await this.expectTitle('Checkout: Overview');
  }

  overviewItem(name: string): CartItem {
    return new CartItem(this.overviewItems.filter({ hasText: name }));
  }

  async getOrderSummary(): Promise<OrderSummary> {
    return {
      itemTotal: parsePrice(await this.subtotalLabel.innerText()),
      tax: parsePrice(await this.taxLabel.innerText()),
      total: parsePrice(await this.totalLabel.innerText()),
    };
  }

  async getOverviewItemNames(): Promise<string[]> {
    return (await this.overviewItems.getByTestId('inventory-item-name').allInnerTexts()).map((n) => n.trim());
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  async backHome(): Promise<void> {
    await this.backHomeButton.click();
  }

  async finish(): Promise<void> {
    await this.finishButton.click();
  }

  async expectOrderComplete(): Promise<void> {
    await expect(this.page).toHaveURL(/\/checkout-complete\.html$/);
    await this.expectTitle('Checkout: Complete!');
    await expect(this.completeHeader).toHaveText('Thank you for your order!');
  }
}
