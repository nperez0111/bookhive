/// <reference types="jest" />
import React from "react";
import renderer from "react-test-renderer";
import { BackNavigationHeader } from "../BackNavigationHeader";
import { View, Text } from "react-native";

// Mock the dependencies
jest.mock("@/hooks/useColorScheme");
jest.mock("@/constants/Colors");
jest.mock("expo-router");
jest.mock("react-native-safe-area-context");

describe("BackNavigationHeader", () => {
  it("renders without crashing", () => {
    const tree = renderer.create(<BackNavigationHeader />).toJSON();
    expect(tree).toBeTruthy();
  });

  it("renders with a title", () => {
    const tree = renderer.create(<BackNavigationHeader title="Test Title" />);
    const root = tree.root;
    const titleText = root.findAllByType(Text).find((node) => node.children.includes("Test Title"));
    expect(titleText).toBeTruthy();
  });

  it("renders with right element", () => {
    const rightElement = (
      <View testID="right-element">
        <Text>Right</Text>
      </View>
    );
    const tree = renderer.create(<BackNavigationHeader rightElement={rightElement} />);
    const root = tree.root;
    const element = root.findByProps({ testID: "right-element" });
    expect(element).toBeTruthy();
  });
});
