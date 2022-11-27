import fs from "fs";
import path from "path";

import { BaseService } from "medusa-interfaces";
import { INCLUDE_PRESENTMENT_PRICES } from "../utils/const";

class ShopifyService extends BaseService {
  constructor(
    {
      manager,
      shippingProfileService,
      storeService,
      shopifyProductService,
      shopifyCollectionService,
      shopifyClientService
    },
    options
  ) {
    super();

    this.options = options;

    /** @private @const {EntityManager} */
    this.manager_ = manager;
    /** @private @const {ShippingProfileService} */
    this.shippingProfileService_ = shippingProfileService;
    /** @private @const {ShopifyProductService} */
    this.productService_ = shopifyProductService;
    /** @private @const {ShopifyCollectionService} */
    this.collectionService_ = shopifyCollectionService;
    /** @private @const {ShopifyRestClient} */
    this.client_ = shopifyClientService;
    /** @private @const {StoreService} */
    this.store_ = storeService;
  }

  withTransaction(transactionManager) {
    if (!transactionManager || options.json) {
      return this;
    }

    const cloned = new ShopifyService({
      manager: transactionManager,
      options: this.options,
      shippingProfileService: this.shippingProfileService_,
      shopifyClientService: this.client_,
      shopifyProductService: this.productService_,
      shopifyCollectionService: this.collectionService_,
      shopifyBuildService: this.buildService_,
      storeService: this.store_
    });

    cloned.transactionManager_ = transactionManager;

    return cloned;
  }

  async importShopify() {
    return this.atomicPhase_(async (manager) => {
      const { json, updated_after } = this.options;

      let products, customCollections, smartCollections, collects;

      await this.shippingProfileService_.createDefault();
      await this.shippingProfileService_.createGiftCardDefault();

      if (json) {
        if (
          json?.["products_path"] &&
          json?.["custom_collections_path"] &&
          json?.["smart_collections_path"] &&
          json?.["collects_path"]
        ) {
          const processPath = process.cwd();

          try {
            products = JSON.parse(
              fs.readFileSync(
                path.resolve(processPath, json["products_path"]),
                "utf8"
              )
            );
            customCollections = JSON.parse(
              fs.readFileSync(
                path.resolve(processPath, json["custom_collections_path"]),
                "utf8"
              )
            );
            smartCollections = JSON.parse(
              fs.readFileSync(
                path.resolve(processPath, json["smart_collections_path"]),
                "utf8"
              )
            );
            collects = JSON.parse(
              fs.readFileSync(
                path.resolve(processPath, json["collects_path"]),
                "utf8"
              )
            );
          } catch (e) {
            throw new Error(
              `
            Impossible to load or parse one of your file. Please be sure that these 4 files exist and are formatted as valid JSON: 
              - ${path.resolve(processPath, json["products_path"])}
              - ${path.resolve(processPath, json["custom_collections_path"])}
              - ${path.resolve(processPath, json["smart_collections_path"])}
              - ${path.resolve(processPath, json["collects_path"])}
            `,
              {
                cause: e
              }
            );
          }
        } else {
          throw new Error(
            `Incomplete 'json' option. It should include all paths for 'products_path', 'custom_collections_path', 'smart_collections_path' and 'collects_path'.`
          );
        }
      } else {
        let updatedSinceQuery = await this.getAndUpdateBuildTime_();

        if (updated_after) {
          updatedSinceQuery = updated_after;
        }
        if (updated_after === false) {
          updatedSinceQuery = null;
        }

        products = await this.client_.list(
          "products",
          INCLUDE_PRESENTMENT_PRICES,
          updatedSinceQuery
        );

        customCollections = await this.client_.list(
          "custom_collections",
          null,
          updatedSinceQuery
        );

        smartCollections = await this.client_.list(
          "smart_collections",
          null,
          updatedSinceQuery
        );

        collects = await this.client_.list("collects", null, updatedSinceQuery);
      }

      const resolvedProducts = await Promise.all(
        products.map(async (product) => {
          return await this.productService_
            .withTransaction(manager)
            .create(product);
        })
      );

      await this.collectionService_
        .withTransaction(manager)
        .createCustomCollections(collects, customCollections, resolvedProducts);

      await this.collectionService_
        .withTransaction(manager)
        .createSmartCollections(smartCollections, resolvedProducts);
    });
  }

  async getAndUpdateBuildTime_() {
    let buildtime = null;
    const store = await this.store_.retrieve();
    if (!store) {
      return {};
    }

    if (store.metadata?.source_shopify_bt) {
      buildtime = store.metadata.source_shopify_bt;
    }

    const payload = {
      metadata: {
        source_shopify_bt: new Date().toISOString()
      }
    };

    await this.store_.update(payload);

    if (!buildtime) {
      return {};
    }

    return {
      updated_at_min: buildtime
    };
  }
}

export default ShopifyService;
