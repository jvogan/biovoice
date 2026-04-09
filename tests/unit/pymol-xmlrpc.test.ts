import { describe, expect, it } from "vitest";
import { parseXmlRpcResponseValue } from "../../packages/runtime-and-adapters/src/adapters/pymol-adapter.js";

describe("parseXmlRpcResponseValue", () => {
  it("parses array responses used by get_names", () => {
    const response = `<?xml version="1.0"?>
      <methodResponse>
        <params>
          <param>
            <value>
              <array>
                <data>
                  <value><string>1hsg</string></value>
                  <value><string>pocket</string></value>
                </data>
              </array>
            </value>
          </param>
        </params>
      </methodResponse>`;

    expect(parseXmlRpcResponseValue(response)).toEqual(["1hsg", "pocket"]);
  });

  it("parses numeric arrays used by get_view", () => {
    const response = `<?xml version="1.0"?>
      <methodResponse>
        <params>
          <param>
            <value>
              <array>
                <data>
                  <value><double>1.0</double></value>
                  <value><double>0.0</double></value>
                  <value><double>-80.5</double></value>
                </data>
              </array>
            </value>
          </param>
        </params>
      </methodResponse>`;

    expect(parseXmlRpcResponseValue(response)).toEqual([1, 0, -80.5]);
  });
});
