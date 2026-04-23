import React, { Suspense } from 'react';
import { useGLTF } from '@react-three/drei';

// Paths served by harbor-presence server from /public/props/*.glb
const POOL_TABLE_URL = '/props/pool-table.glb';
const SERVER_RACK_URL = '/props/server-rack.glb';
const SOFA_URL = '/props/sofa.glb';
const ARCADE_URL = '/props/arcade.glb';

useGLTF.preload(POOL_TABLE_URL);
useGLTF.preload(SERVER_RACK_URL);
useGLTF.preload(SOFA_URL);
useGLTF.preload(ARCADE_URL);

interface PropProps {
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}

function GLBProp({ url, position, rotation = [0, 0, 0], scale = 1 }: PropProps & { url: string }) {
  const { scene } = useGLTF(url);
  const cloned = React.useMemo(() => scene.clone(true), [scene]);
  return <primitive object={cloned} position={position} rotation={rotation} scale={scale} />;
}

export function HeroProps() {
  return (
    <Suspense fallback={null}>
      {/* Arcade — right-wall alcove behind the desk row */}
      <GLBProp
        url={ARCADE_URL}
        position={[13, 0, -9]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={1.8}
      />

      {/* Server rack — back-left cyber corner, humming ominously */}
      <GLBProp
        url={SERVER_RACK_URL}
        position={[-13.5, 0, -13.5]}
        rotation={[0, Math.PI / 4, 0]}
        scale={2.2}
      />

      {/* Pool table — southwest lounge annex */}
      <GLBProp url={POOL_TABLE_URL} position={[-11, 0, 11]} rotation={[0, 0, 0]} scale={1.1} />

      {/* Sofa — chill corner by Margot's desk side */}
      <GLBProp
        url={SOFA_URL}
        position={[12.5, 0, 12]}
        rotation={[0, -Math.PI * 0.75, 0]}
        scale={1.5}
      />
    </Suspense>
  );
}
