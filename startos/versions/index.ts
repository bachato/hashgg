import { VersionGraph } from '@start9labs/start-sdk'
import { v_0_2_0_0 } from './v0.2.0.0'
import { v_0_3_0_0 } from './v0.3.0.0'
import { v_0_6_0_0 } from './v0.6.0.0'
import { v_0_7_0_0 } from './v0.7.0.0'
import { v_0_7_1_0 } from './v0.7.1.0'
import { v_0_7_2_0 } from './v0.7.2.0'
import { v_0_7_2_1 } from './v0.7.2.1'

export const versionGraph = VersionGraph.of({
  current: v_0_7_2_1,
  other: [v_0_2_0_0, v_0_3_0_0, v_0_6_0_0, v_0_7_0_0, v_0_7_1_0, v_0_7_2_0],
})
