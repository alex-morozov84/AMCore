// Pinned upstream source hashes. Updating this manifest requires semantic review.
export const SCRIPT_PROVENANCE = {
  package: 'bullmq',
  version: '6.3.11',
  license: 'MIT',
  scripts: {
    'pause-7': {
      sources: {
        'pause-7.lua': '0b30955bf97abe6a0f4eb4b4bdeb0d504bc34d9bf0e5ac5eff41ca391d2a6f0e',
        'includes/addDelayMarkerIfNeeded.lua':
          '1a55c5edda6b3c54270831aad482f7e9850f492fd89660a50e63eabdb31c9656',
        'includes/getNextDelayedTimestamp.lua':
          'b2e7b56676668f78ea01270f3daab3667ab68ea963671b3468e2018af75eb6e4',
        'includes/getWaitPlusPrioritizedCount.lua':
          '035e5ac25d7a661d8132688cd9057e6c00aa188b8c3740f0479613a3a36ae796',
      },
      compiledSha256: 'da797a84855a762e0d48310c70684504c42c86cdd7a1d941aba96300bbf3646c',
    },
    'reprocessJob-7': {
      sources: {
        'reprocessJob-7.lua': 'eb55cf92e9150dc67851754bd65cc03c9d22dfbe8e7d1aa5bf9086057c52693a',
        'includes/addJobInTargetList.lua':
          '356385ce8c4ba1841de955ac76af5381f3b2074628133e870c2035c3d64a62a2',
        'includes/addBaseMarkerIfNeeded.lua':
          'bbdfb3922acec0e812a1f99988160bb7faab8099bf402d3cfc2dc96f81b6c00f',
        'includes/getOrSetMaxEvents.lua':
          'ec9e059a7d303cff34329453cc4747be9f20bc4824abcb397ca4847c52bac8c4',
        'includes/isQueuePausedOrMaxed.lua':
          'b347fdeb087c7a7c6fda41e845f56f6ab8a34999238cff57fc33efcf63e9bee3',
      },
      compiledSha256: '8bf1c51038f2d3b8e73e8a0f4d05c99de4121911a8355254f2bf7d01be8314a7',
    },
    'removeJob-2': {
      sources: {
        'removeJob-2.lua': '8e14c006968b11d9a04128aa8c4a89df58ad917a0d4e8a3c9afce5c13cb7a557',
        'includes/isJobSchedulerJob.lua':
          '2c4c960d75094304f7d07e5ea06f1dbc7c2b593885aebbe35c4222f924e15ffd',
        'includes/isLocked.lua': 'eaa9bc81b6391f4cb0106866b9f7d4c79d8976f3d38a79544b9a5a05361bf22f',
        'includes/destructureJobKey.lua':
          'c5d4d00b305cd60f4c8449c4aa8e928135a1f7ab3e70afb00cfac774385fdb20',
        'includes/removeJobWithChildren.lua':
          '1117256971fc23ceaa1e5812418a72498b25bdf259011e13257cc8d577ac3333',
        'includes/getOrSetMaxEvents.lua':
          'ec9e059a7d303cff34329453cc4747be9f20bc4824abcb397ca4847c52bac8c4',
        'includes/removeDeduplicationKeyIfNeededOnRemoval.lua':
          'cf3fe8a640a44fd8637f96afe5b28f2e8a619fa7f986416f243f050815d13399',
        'includes/removeJobFromAnyState.lua':
          'c89a2da89b69667fd4f73aa133d9ea5a52d2f2c33803c75bea9c7482d4947612',
        'includes/removeJobKeys.lua':
          '3ef7537779443d1f580acce3352f3d57050b9dbbac952c62911ca36d4201ad67',
        'includes/removeParentDependencyKey.lua':
          '2a97d866674d7c98ad82fec7a897c24cd46e22ab12ce6a305480414005b66633',
        'includes/addJobInTargetList.lua':
          '356385ce8c4ba1841de955ac76af5381f3b2074628133e870c2035c3d64a62a2',
        'includes/addBaseMarkerIfNeeded.lua':
          'bbdfb3922acec0e812a1f99988160bb7faab8099bf402d3cfc2dc96f81b6c00f',
        'includes/isQueuePausedOrMaxed.lua':
          'b347fdeb087c7a7c6fda41e845f56f6ab8a34999238cff57fc33efcf63e9bee3',
      },
      compiledSha256: 'f2acb16fda20ccac200abd5289a8910e48870d454c1577b19bd375ab809bb4b6',
    },
    'moveToDelayed-11': {
      sources: {
        'moveToDelayed-11.lua': 'f2c27d4e0f449633d08f09976f4de3d9b7bcbbb34f89fd68cfc53389a24f6687',
        'includes/addDelayMarkerIfNeeded.lua':
          '1a55c5edda6b3c54270831aad482f7e9850f492fd89660a50e63eabdb31c9656',
        'includes/getNextDelayedTimestamp.lua':
          'b2e7b56676668f78ea01270f3daab3667ab68ea963671b3468e2018af75eb6e4',
        'includes/fetchNextJob.lua':
          '0a58476bafccaaed14c0d7b525ba404dcb01e0cd45b6504bc35ee6e9ffa61514',
        'includes/getQueueMetadata.lua':
          '10799ec741d9845f4a6ec9317cd22f30daabfa4c55159b2b3a14e8330c2c1298',
        'includes/getRateLimitTTL.lua':
          'c11ca472bd6817b0e24311f65571b1a665ca668ea1ec08cfa0cf7e356d372ce6',
        'includes/moveJobFromPrioritizedToActive.lua':
          '7ff9813350e337debb58b0eaf6f83680e51adb9196d8f4dc184eae0990517bce',
        'includes/prepareJobForProcessing.lua':
          'b1cc78fa3446e8ec3f52585f67a42fe40faf4d3f0328216bf8b6ed58106b4668',
        'includes/addBaseMarkerIfNeeded.lua':
          'bbdfb3922acec0e812a1f99988160bb7faab8099bf402d3cfc2dc96f81b6c00f',
        'includes/promoteDelayedJobs.lua':
          '589b54b638e2c7f81b3815c40ac7b4f509b4d842f0823dcfea4c3346920bc3c4',
        'includes/addJobInTargetList.lua':
          '356385ce8c4ba1841de955ac76af5381f3b2074628133e870c2035c3d64a62a2',
        'includes/addJobWithPriority.lua':
          'b01312aa67e05384933c9a8d0f5ca752e6fb6a10d23cfb1da6988d566758dfc7',
        'includes/getPriorityScore.lua':
          '2543a3e682c15d9d8466b633aeb3a6d54a813ec23b5aa7aaf636457d62610206',
        'includes/getDelayedScore.lua':
          '18547f918fdc531bfe0f0b65c52fe3e8574d31fa99563e790703c6965b493db3',
        'includes/getOrSetMaxEvents.lua':
          'ec9e059a7d303cff34329453cc4747be9f20bc4824abcb397ca4847c52bac8c4',
        'includes/removeLock.lua':
          'b88f066760e53683fd27727b086d7dcd0e792a0d0a65e12e1f3e829339d808ba',
        'includes/updateJobFields.lua':
          'ea81b9ee826e1146c2c0aa5b56e580acf8fe87c31bef56639c0c80d349e11e37',
      },
      compiledSha256: '1a7b9311ef92fd66416973c29fa8b2c909cec58d0bfcf3e5ab53bb07ea1664d7',
    },
  },
} as const
