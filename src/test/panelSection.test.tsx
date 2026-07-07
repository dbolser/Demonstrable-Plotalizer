import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { PanelSection } from '../../components/PanelSection';

describe('PanelSection', () => {
  it('renders children when defaultOpen and hides them after toggling closed', () => {
    const { getByRole, queryByText } = render(
      <PanelSection title="Data" defaultOpen>
        <p>section content</p>
      </PanelSection>
    );

    const header = getByRole('button', { name: /Data/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(queryByText('section content')).not.toBeNull();

    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(queryByText('section content')).toBeNull();
  });

  it('starts collapsed by default and expands on header click', () => {
    const { getByRole, queryByText } = render(
      <PanelSection title="Export">
        <p>export tools</p>
      </PanelSection>
    );

    const header = getByRole('button', { name: /Export/ });
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(queryByText('export tools')).toBeNull();

    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(queryByText('export tools')).not.toBeNull();
  });

  it('is keyboard-accessible: the header button toggles on Enter and Space and controls the content region', async () => {
    const user = userEvent.setup();
    const { getByRole, queryByText } = render(
      <PanelSection title="Analysis">
        <p>analysis tools</p>
      </PanelSection>
    );

    const header = getByRole('button', { name: /Analysis/ });
    expect(header.tagName).toBe('BUTTON');

    // The button must be programmatically linked to the region it expands.
    const contentId = header.getAttribute('aria-controls');
    expect(contentId).toBeTruthy();

    header.focus();
    await user.keyboard('{Enter}');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(queryByText('analysis tools')).not.toBeNull();
    expect(document.getElementById(contentId!)?.textContent).toContain('analysis tools');

    await user.keyboard(' ');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(queryByText('analysis tools')).toBeNull();
  });

  it('shows the hint only while collapsed and the badge always', () => {
    const { getByRole, queryByText, getByTestId } = render(
      <PanelSection
        title="Color"
        hint="rainbow"
        badge={<span data-testid="color-badge">2</span>}
      >
        <p>color controls</p>
      </PanelSection>
    );

    expect(queryByText('rainbow')).not.toBeNull();
    expect(getByTestId('color-badge')).toBeTruthy();

    fireEvent.click(getByRole('button', { name: /Color/ }));
    expect(queryByText('rainbow')).toBeNull();
    expect(getByTestId('color-badge')).toBeTruthy();
  });
});
