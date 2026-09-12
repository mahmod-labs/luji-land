// Wires the existing builder self-check (src/config.spec.ts) into `make test`
// / `npm test` as a real jest test, instead of duplicating its assertions.
test('config refuses to boot without DIRECTORY_DATABASE_URL (builder self-check)', () => {
  jest.isolateModules(() => {
    require('../src/config.spec');
  });
});
