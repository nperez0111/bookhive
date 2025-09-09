import React from 'react';
import { render } from '@testing-library/react-native';
import { BackNavigationHeader } from '../BackNavigationHeader';

// Mock the dependencies
jest.mock('@/hooks/useColorScheme');
jest.mock('@/constants/Colors');
jest.mock('expo-router');
jest.mock('react-native-safe-area-context');

describe('BackNavigationHeader', () => {
  it('renders without crashing', () => {
    const { getByRole } = render(<BackNavigationHeader />);
    // Should render the back button
    expect(getByRole('button')).toBeTruthy();
  });

  it('renders with a title', () => {
    const { getByText } = render(<BackNavigationHeader title="Test Title" />);
    expect(getByText('Test Title')).toBeTruthy();
  });

  it('renders with right element', () => {
    const rightElement = <div testID="right-element">Right</div>;
    const { getByTestId } = render(
      <BackNavigationHeader rightElement={rightElement} />
    );
    expect(getByTestId('right-element')).toBeTruthy();
  });
});