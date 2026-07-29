import { VersionInfo } from '@start9labs/start-sdk'

export const v_0_7_2_0 = VersionInfo.of({
  version: '0.7.2:0',
  releaseNotes: {
    en_US:
      'You can now make your Bitcoin node reachable without setting up mining. It is offered on ' +
      'the first screen alongside the tunnel choices, and if you stop there the dashboard treats ' +
      'mining as a choice you have not made rather than something wrong.\n\n' +
      'The guided reachability setup had no button to start it — the instructions appeared and ' +
      'nothing followed. That is fixed, and once it is finished the section says so instead of ' +
      'repeating the setup steps back at you.\n\n' +
      'Sharing one server between two HashGG installations is now safe. Setting up a second ' +
      'machine against a server another was already using would quietly replace the first one’s ' +
      'access, and its tunnel stopped at the next reconnect. Each installation now keeps its own ' +
      'access, and removing one leaves the others working.\n\n' +
      'If a port is already taken on your server, HashGG says which one and offers a free ' +
      'alternative in one click, rather than failing with a message from ssh. Two nodes can share ' +
      'one server on different ports.',
  },
  // Nothing to migrate: "is HashGG set up" is inferred from the two records
  // that already exist rather than stored, so there is no new field and no
  // stored value whose meaning has changed.
  migrations: {
    up: async ({ effects }) => {},
    down: async ({ effects }) => {},
  },
})
