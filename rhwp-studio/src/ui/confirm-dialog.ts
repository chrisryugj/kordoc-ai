/**
 * 확인/취소 대화상자
 *
 * 브라우저 기본 confirm() 대신 앱 UI와 일관된 모달 대화상자를 제공한다.
 * showConfirm() 헬퍼로 간단히 사용 가능.
 */
import { ModalDialog } from './dialog';

class ConfirmDialog extends ModalDialog {
  private message: string;
  private resolve!: (value: boolean) => void;

  constructor(title: string, message: string) {
    super(title, 360);
    this.message = message;
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.style.padding = '16px 20px';
    body.style.lineHeight = '1.6';
    body.style.whiteSpace = 'pre-line';
    body.textContent = this.message;
    return body;
  }

  protected onConfirm(): void {
    this.resolve(true);
  }

  override hide(): void {
    this.resolve(false);
    super.hide();
  }

  showAsync(): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;
      this.resolve = (v: boolean) => {
        if (!resolved) {
          resolved = true;
          resolve(v);
        }
      };
      super.show();
    });
  }
}

/** 확인/취소 모달 대화상자를 표시하고 사용자 선택을 반환한다. */
export function showConfirm(title: string, message: string): Promise<boolean> {
  return new ConfirmDialog(title, message).showAsync();
}
