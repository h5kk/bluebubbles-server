module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    roots: ["<rootDir>/src"],
    moduleNameMapper: {
        "^@server$": "<rootDir>/src/server/index",
        "^@server/(.*)$": "<rootDir>/src/server/$1",
        "^@windows/(.*)$": "<rootDir>/src/windows/$1",
        "^@trays/(.*)$": "<rootDir>/src/trays/$1"
    },
    testMatch: ["**/__tests__/**/*.test.ts"]
};
