/**
 * HTML to React Native Text Components Parser
 * Handles inline HTML elements and converts them to React Native Text components
 * Supports nested tags like <i><b>bold and italic</b></i>
 */

import React from "react";
import { Text, Linking } from "react-native";

// Default styles for inline elements
const DEFAULT_STYLES = {
  b: { fontWeight: "bold" as const },
  strong: { fontWeight: "bold" as const },
  i: { fontStyle: "italic" as const },
  em: { fontStyle: "italic" as const },
  u: { textDecorationLine: "underline" as const },
  s: { textDecorationLine: "line-through" as const },
  strike: { textDecorationLine: "line-through" as const },
  a: { color: "#007AFF", textDecorationLine: "underline" as const },
  br: {},
  span: {},
  default: {},
};

interface HtmlToTextProps {
  html: string;
  style?: any;
  containerStyle?: any;
}

interface ParsedElement {
  type: "text" | "tag";
  content?: string;
  tag?: string;
  attributes?: Record<string, string>;
  children?: ParsedElement[];
}

/**
 * Parse HTML string into a tree structure that handles nested tags
 */
function parseHtmlToTree(html: string): ParsedElement[] {
  if (!html) return [];

  const elements: ParsedElement[] = [];
  let currentIndex = 0;

  while (currentIndex < html.length) {
    // Find the next tag
    const tagStart = html.indexOf("<", currentIndex);

    if (tagStart === -1) {
      // No more tags, add remaining text
      const remainingText = html.substring(currentIndex);
      if (remainingText.trim()) {
        elements.push({
          type: "text",
          content: remainingText,
        });
      }
      break;
    }

    // Add text before the tag
    if (tagStart > currentIndex) {
      const textContent = html.substring(currentIndex, tagStart);
      if (textContent.trim()) {
        elements.push({
          type: "text",
          content: textContent,
        });
      }
    }

    // Find the end of the tag
    const tagEnd = html.indexOf(">", tagStart);
    if (tagEnd === -1) {
      // Malformed HTML, treat as text
      const remainingText = html.substring(currentIndex);
      if (remainingText.trim()) {
        elements.push({
          type: "text",
          content: remainingText,
        });
      }
      break;
    }

    const fullTag = html.substring(tagStart, tagEnd + 1);
    const isClosingTag = fullTag.startsWith("</");

    if (isClosingTag) {
      // This is a closing tag, we'll handle it in the opening tag logic
      currentIndex = tagEnd + 1;
      continue;
    }

    // Parse opening tag
    const tagMatch = fullTag.match(/<(\w+)(?:\s+([^>]*))?>/);
    if (tagMatch) {
      const [, tagName, attributes] = tagMatch;

      // Parse attributes
      const attrs: Record<string, string> = {};
      if (attributes) {
        const attrRegex = /(\w+)=["']([^"']*)["']/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attributes)) !== null) {
          attrs[attrMatch[1]] = attrMatch[2];
        }
      }

      // Find the matching closing tag
      const closingTagPattern = new RegExp(`</${tagName}>`, "gi");
      const closingMatch = closingTagPattern.exec(html.substring(tagEnd + 1));

      if (closingMatch) {
        const contentStart = tagEnd + 1;
        const contentEnd = tagEnd + 1 + closingMatch.index;
        const content = html.substring(contentStart, contentEnd);

        // Recursively parse the content
        const children = parseHtmlToTree(content);

        elements.push({
          type: "tag",
          tag: tagName,
          attributes: attrs,
          children: children,
        });

        currentIndex = tagEnd + 1 + closingMatch.index + closingMatch[0].length;
      } else {
        // Self-closing tag or malformed HTML
        if (tagName === "br") {
          elements.push({
            type: "tag",
            tag: tagName,
            attributes: attrs,
          });
        }
        currentIndex = tagEnd + 1;
      }
    } else {
      currentIndex = tagEnd + 1;
    }
  }

  return elements;
}

/**
 * Render parsed elements as React Native Text components with proper nesting
 */
function renderElements(
  elements: ParsedElement[],
  parentStyle: any = {},
  keyPrefix: string = "",
): React.ReactNode[] {
  const components: React.ReactNode[] = [];
  let keyCounter = 0;

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    const key = `${keyPrefix}_${i}`;

    if (element.type === "text") {
      if (element.content) {
        components.push(
          <Text key={`${key}_text_${keyCounter++}`} style={parentStyle}>
            {element.content}
          </Text>,
        );
      }
    } else if (element.type === "tag") {
      const tagName = element.tag;

      if (tagName === "br") {
        components.push(
          <Text key={`${key}_br_${keyCounter++}`} style={parentStyle}>
            {"\n"}
          </Text>,
        );
      } else if (tagName === "a") {
        const href = element.attributes?.href || "#";
        const linkStyle = [parentStyle, DEFAULT_STYLES.a];

        components.push(
          <Text
            key={`${key}_link_${keyCounter++}`}
            style={linkStyle}
            onPress={() => {
              if (href && href !== "#") {
                Linking.canOpenURL(href)
                  .then((supported) => {
                    if (supported) {
                      return Linking.openURL(href);
                    } else {
                      console.warn("Can't handle url: " + href);
                    }
                  })
                  .catch((err) => console.error("An error occurred", err));
              }
            }}
          >
            {element.children
              ? renderElements(element.children, linkStyle, `${key}_children`)
              : href}
          </Text>,
        );
      } else if (
        tagName &&
        DEFAULT_STYLES[tagName as keyof typeof DEFAULT_STYLES]
      ) {
        // Handle other inline elements with nesting
        const tagStyle = [
          parentStyle,
          DEFAULT_STYLES[tagName as keyof typeof DEFAULT_STYLES],
        ];

        if (element.children && element.children.length > 0) {
          // Render children with the combined style
          const childComponents = renderElements(
            element.children,
            tagStyle,
            `${key}_children`,
          );
          components.push(
            <Text key={`${key}_${tagName}_${keyCounter++}`} style={tagStyle}>
              {childComponents}
            </Text>,
          );
        } else {
          // Self-closing tag or no content
          components.push(
            <Text key={`${key}_${tagName}_${keyCounter++}`} style={tagStyle}>
              {/* Empty content */}
            </Text>,
          );
        }
      } else {
        // Unknown tag, just render children
        if (element.children) {
          const childComponents = renderElements(
            element.children,
            parentStyle,
            `${key}_unknown`,
          );
          components.push(...childComponents);
        }
      }
    }
  }

  return components;
}

/**
 * HTML to React Native Text components parser with nested tag support
 */
export function HtmlToText({
  html,
  style,
  containerStyle,
}: HtmlToTextProps): React.ReactElement {
  if (!html || typeof html !== "string") {
    return <Text style={style}>No description available</Text>;
  }

  // Parse HTML into tree structure
  const elements = parseHtmlToTree(html);

  // Render elements with proper nesting
  const components = renderElements(elements, style, "root");

  return <Text style={[containerStyle, style]}>{components}</Text>;
}

/**
 * Simple function to convert HTML to text (backward compatible)
 */
export function parseHtmlToText(html: string): string {
  if (!html || typeof html !== "string") {
    return "No description available";
  }

  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "") // Remove all HTML tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, "\n\n") // Remove excessive line breaks
    .trim();
}
