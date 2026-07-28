import { McpServer } from "../../../src/index.js"

// This fixture must not compile: the stable core no longer exposes Effect AI
// Tool/Toolkit adapters. The fixture runner verifies this exact diagnostic.
McpServer.registerToolkit({})
