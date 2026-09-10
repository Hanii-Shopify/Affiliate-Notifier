import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import type { ValueType } from "../lib/value-type";

const CREATE_DISCOUNT_MUTATION = `#graphql
  mutation CreateAffiliateDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            codes(first: 1) {
              nodes { code }
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

const DEACTIVATE_DISCOUNT_MUTATION = `#graphql
  mutation DeactivateAffiliateDiscount($id: ID!) {
    discountCodeDeactivate(id: $id) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }
`;

const ACTIVATE_DISCOUNT_MUTATION = `#graphql
  mutation ActivateAffiliateDiscount($id: ID!) {
    discountCodeActivate(id: $id) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }
`;

const DELETE_DISCOUNT_MUTATION = `#graphql
  mutation DeleteAffiliateDiscount($id: ID!) {
    discountCodeDelete(id: $id) {
      deletedCodeDiscountId
      userErrors { field message }
    }
  }
`;

const UPDATE_DISCOUNT_MUTATION = `#graphql
  mutation UpdateAffiliateDiscount($id: ID!, $basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicUpdate(id: $id, basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            codes(first: 1) {
              nodes { code }
            }
          }
        }
      }
      userErrors { field message }
    }
  }
`;

function slugify(name: string) {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function randomSuffix() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function discountValueInput(discountType: ValueType, discountValue: number) {
  return discountType === "PERCENTAGE"
    ? { percentage: discountValue / 100 }
    : {
        discountAmount: {
          amount: discountValue.toFixed(2),
          appliesOnEachItem: false,
        },
      };
}

export async function createAffiliateDiscount(
  admin: AdminApiContext,
  {
    name,
    discountType,
    discountValue,
    customCode,
  }: {
    name: string;
    discountType: ValueType;
    discountValue: number;
    customCode?: string;
  },
) {
  const sanitizedCustomCode = customCode
    ?.toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
  const code = sanitizedCustomCode || `AFF-${slugify(name)}-${randomSuffix()}`;

  const response = await admin.graphql(CREATE_DISCOUNT_MUTATION, {
    variables: {
      basicCodeDiscount: {
        title: `Affiliate: ${name}`,
        code,
        startsAt: new Date().toISOString(),
        customerSelection: { all: true },
        customerGets: {
          value: discountValueInput(discountType, discountValue),
          items: { all: true },
        },
        appliesOncePerCustomer: false,
      },
    },
  });

  const json = await response.json();
  const result = json.data?.discountCodeBasicCreate;
  const userErrors = result?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(
      `Failed to create Shopify discount code: ${userErrors
        .map((error: { message: string }) => error.message)
        .join(", ")}`,
    );
  }

  const discountNode = result?.codeDiscountNode;
  const createdCode = discountNode?.codeDiscount?.codes?.nodes?.[0]?.code;

  if (!discountNode?.id || !createdCode) {
    throw new Error("Shopify did not return a discount code node.");
  }

  return {
    shopifyDiscountId: discountNode.id as string,
    discountCode: createdCode as string,
  };
}

export async function deactivateAffiliateDiscount(
  admin: AdminApiContext,
  shopifyDiscountId: string,
) {
  const response = await admin.graphql(DEACTIVATE_DISCOUNT_MUTATION, {
    variables: { id: shopifyDiscountId },
  });

  const json = await response.json();
  const userErrors = json.data?.discountCodeDeactivate?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(
      `Failed to deactivate Shopify discount code: ${userErrors
        .map((error: { message: string }) => error.message)
        .join(", ")}`,
    );
  }
}

export async function activateAffiliateDiscount(
  admin: AdminApiContext,
  shopifyDiscountId: string,
) {
  const response = await admin.graphql(ACTIVATE_DISCOUNT_MUTATION, {
    variables: { id: shopifyDiscountId },
  });

  const json = await response.json();
  const userErrors = json.data?.discountCodeActivate?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(
      `Failed to reactivate Shopify discount code: ${userErrors
        .map((error: { message: string }) => error.message)
        .join(", ")}`,
    );
  }
}

export async function updateAffiliateDiscount(
  admin: AdminApiContext,
  shopifyDiscountId: string,
  {
    name,
    discountType,
    discountValue,
    customCode,
  }: {
    name: string;
    discountType: ValueType;
    discountValue: number;
    customCode?: string;
  },
) {
  const sanitizedCustomCode = customCode?.toUpperCase().replace(/[^A-Z0-9-]/g, "");

  const response = await admin.graphql(UPDATE_DISCOUNT_MUTATION, {
    variables: {
      id: shopifyDiscountId,
      basicCodeDiscount: {
        title: `Affiliate: ${name}`,
        ...(sanitizedCustomCode ? { code: sanitizedCustomCode } : {}),
        customerGets: {
          value: discountValueInput(discountType, discountValue),
          items: { all: true },
        },
      },
    },
  });

  const json = await response.json();
  const result = json.data?.discountCodeBasicUpdate;
  const userErrors = result?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(
      `Failed to update Shopify discount code: ${userErrors
        .map((error: { message: string }) => error.message)
        .join(", ")}`,
    );
  }

  const updatedCode = result?.codeDiscountNode?.codeDiscount?.codes?.nodes?.[0]?.code as
    | string
    | undefined;

  return { discountCode: updatedCode };
}

export async function deleteAffiliateDiscount(
  admin: AdminApiContext,
  shopifyDiscountId: string,
) {
  const response = await admin.graphql(DELETE_DISCOUNT_MUTATION, {
    variables: { id: shopifyDiscountId },
  });

  const json = await response.json();
  const userErrors = json.data?.discountCodeDelete?.userErrors ?? [];

  if (userErrors.length > 0) {
    throw new Error(
      `Failed to delete Shopify discount code: ${userErrors
        .map((error: { message: string }) => error.message)
        .join(", ")}`,
    );
  }
}
