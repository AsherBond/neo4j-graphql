/*
 * Copyright (c) "Neo4j"
 * Neo4j Sweden AB [http://neo4j.com]
 *
 * This file is part of Neo4j.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as neo4j from "neo4j-driver";
import type { UniqueType } from "../../utils/graphql-types";
import { TestHelper } from "../../utils/tests-helper";

describe("issue/duplicate-connect", () => {
    const testHelper = new TestHelper();

    let Movie: UniqueType;
    let Actor: UniqueType;

    beforeEach(async () => {
        Movie = testHelper.createUniqueType("Movie");
        Actor = testHelper.createUniqueType("Actor");

        const typeDefs = /* GraphQL */ `
            type ${Movie} @node {
                title: String!
                runtime: Int!
                actors: [${Actor}!]! @relationship(type: "ACTED_IN", direction: IN, properties: "ActedIn")
            }

            type ActedIn @relationshipProperties {
                screenTime: Int!
            }

            type ${Actor} @node {
                name: String!
                actedIn: [${Movie} !]! @relationship(type: "ACTED_IN", direction: OUT, properties: "ActedIn")
            }
        `;

        await testHelper.initNeo4jGraphQL({
            typeDefs,
        });
    });

    afterEach(async () => {
        await testHelper.close();
    });

    // FLAKY_TEST
    // update -> connect -> edge
    test("update interface relationship, connect edge", async () => {
        const actorName = "actor1";
        const actorName2 = "actor2";
        const actorName3 = "another actor";

        const movieTitle = "movie1";
        const movieTitle2 = "movie2";
        const movieRuntime = 3730;
        const movieScreenTime = 94414;

        await testHelper.executeCypher(
            `
                CREATE (a:${Actor} { name: $actorName })
                CREATE (a2:${Actor} { name: $actorName2 })
                CREATE (:${Actor} { name: $actorName3 })
                CREATE (m:${Movie} { title: $movieTitle, runtime:$movieRuntime })
                CREATE (m2:${Movie} { title: $movieTitle2, runtime:$movieRuntime })
                CREATE (a)-[:ACTED_IN { screenTime: $movieScreenTime }]->(m)
                CREATE (a)-[:ACTED_IN { screenTime: $movieScreenTime }]->(m2)
                CREATE (a2)-[:ACTED_IN { screenTime: $movieScreenTime }]->(m2)
            `,
            {
                actorName,
                actorName2,
                actorName3,
                movieTitle,
                movieTitle2,
                movieRuntime,
                movieScreenTime,
            }
        );

        const query = /* GraphQL */ `
            mutation {
                ${Actor.operations.update}(update: { 
                    actedIn: [{ 
                        where: { node: { title: { eq: "${movieTitle}" } } } 
                        update: { 
                            node: { 
                                actors: [{                          
                                    connect: {  
                                        where: { node: { name: { eq: "${actorName3}" } } }, 
                                        edge: { screenTime: 111 }, 
                                    } 
                                }] 
                            } 
                        } 
                    }] 
                }) {
                    ${Actor.plural} {
                        name
                    }
                }
            }
        `;

        const gqlResult = await testHelper.executeGraphQL(query);

        expect(gqlResult.errors).toBeFalsy();

        expect(gqlResult.data).toEqual({
            [Actor.operations.update]: {
                [Actor.plural]: expect.toIncludeSameMembers([
                    {
                        name: actorName,
                    },
                    {
                        name: actorName2,
                    },
                    {
                        name: actorName3,
                    },
                ]),
            },
        });

        const rawResult = await testHelper.executeCypher(
            `
                MATCH (a:${Actor})-[r:ACTED_IN]->(m:${Movie})
                RETURN a.name as name, r.screenTime as screenTime, m.title as title
            `,
            {}
        );

        const result = rawResult.records.map((record) => record.toObject());
        console.log(JSON.stringify(result, null, 2));
        expect(result).toIncludeSameMembers([
            {
                name: actorName,
                screenTime: neo4j.int(movieScreenTime),
                title: movieTitle,
            },
            {
                name: actorName,
                screenTime: neo4j.int(movieScreenTime),
                title: movieTitle2,
            },
            {
                name: actorName2,
                screenTime: neo4j.int(movieScreenTime),
                title: movieTitle2,
            },
            {
                name: actorName3,
                screenTime: neo4j.int(movieScreenTime),
                title: movieTitle,
            },
        ]);
    });
});
